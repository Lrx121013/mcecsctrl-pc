'use strict';
/**
 * modules/mc.js —— 模块9：MC 玩家在线看板
 * 直接向 ECS 公网 IP:MC_PORT 发送 Server List Ping，解析在线人数/玩家/MOTD。
 * 无需任何依赖，纯 Node net 手写数据包。
 */
const net = require('net');
const { ENV } = require('./config');
const { describeInstance } = require('./ecs');

/* varint 读写 */
function writeVarint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}
function readVarint(buf, i) {
  let res = 0, shift = 0;
  while (true) {
    const b = buf[i++];
    res |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [res, i];
}

/** 构造 handshake 包。 */
function buildHandshake(host, port, proto) {
  const body = [];
  body.push(...writeVarint(1));
  body.push(...writeVarint(proto));
  const addrBytes = Buffer.from(host, 'utf8');
  body.push(...writeVarint(addrBytes.length));
  for (const b of addrBytes) body.push(b);
  body.push(...writeVarint(port));
  body.push(...writeVarint(1));
  const pkt = [0x00, ...writeVarint(body.length), ...body];
  return Buffer.from(pkt);
}

/** 对 host:port 做一次 MC 状态探测。 */
function mcPing(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    let data = Buffer.alloc(0);
    const finish = (o) => { if (s.destroyed === false) s.destroy(); resolve(o); };
    s.on('error', (e) => finish({ ok: false, reason: e.code || e.message }));
    s.on('timeout', () => finish({ ok: false, reason: 'timeout ' + timeoutMs + 'ms' }));
    s.on('connect', () => {
      const statusReq = Buffer.from([0x01, ...writeVarint(0)]);
      s.write(Buffer.concat([buildHandshake(host, port, 763), statusReq]));
    });
    s.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length < 2) return;
      if (data[0] !== 0x00) return;
      let i = 1;
      let payloadLen, j;
      [payloadLen, i] = readVarint(data, i);
      if (data.length < i + payloadLen) return; // 还需更多字节
      const payload = data.slice(i, i + payloadLen);
      // 现代版：payload = varint(jsonLen) + json
      let jsonText = null;
      try {
        let j2 = 0, sLen;
        [sLen, j2] = readVarint(payload, j2);
        jsonText = payload.slice(j2, j2 + sLen).toString('utf8');
      } catch (e) { jsonText = null; }
      let parsed = null;
      if (jsonText) { try { parsed = JSON.parse(jsonText); } catch (e) { parsed = null; } }
      if (parsed && parsed.response) {
        const resp = parsed.response;
        const players = (resp.players && resp.players.sample) || [];
        return finish({
          ok: true,
          modern: true,
          version: resp.version && (resp.version.name || String(resp.version.protocol)),
          online: resp.players && resp.players.online != null ? resp.players.online : players.length,
          max: resp.players && resp.players.max || 0,
          motd: resp.motd && (resp.motd.text || resp.motd.clean) || '',
          players: players.map((p) => ({ name: p.name, id: p.id, uuid: p.uuid })),
        });
      }
      // 旧版（1.8 及以前）
      const legacy = payload.toString('utf8').replace(/\u0000/g, '|').split('|');
      const m = (legacy[2] || '').split('/');
      return finish({
        ok: true,
        legacy: true,
        online: m.length ? parseInt(m[0], 10) || 0 : 0,
        max: m.length > 1 ? parseInt(m[1], 10) || 0 : 0,
        motd: legacy[1] || '',
        players: [],
      });
    });
  });
}

async function mc() {
  let info;
  try {
    info = await describeInstance();
  } catch (e) {
    return { ok: false, msg: '取实例失败：' + e.message };
  }
  const out = { ok: true, status: info.status, publicIp: info.publicIp, online: null, players: [], mc: null };
  if (info.status !== 'Running' || !info.publicIp) {
    out.reason = '实例未运行或无公网 IP，无法探测 MC 服';
    return out;
  }
  const p = await mcPing(info.publicIp, ENV.MC_PORT);
  out.mc = p;
  if (p.ok) {
    out.online = p.online;
    out.max = p.max;
    out.players = p.players || [];
    out.motd = p.motd;
    out.version = p.version;
  } else {
    out.reason = 'MC 探测失败：' + (p.reason || 'unknown');
  }
  return out;
}

module.exports = { mc, mcPing };
