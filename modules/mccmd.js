'use strict';
/**
 * modules/mccmd.js —— MC 指令模式：通过 RCON 把指令发给正在运行的 MC 服务器
 * （say / kick / whitelist / op / tps / clearlag / we …）。前端另带一份"全量 MC 指令提示"
 * 列表做 autocomplete（含常用插件/模组指令）。
 * 需要 server.properties 启用 RCON + 安全组放行 MC_RCON_PORT（建议仅限家庭 IP）。
 */
const net = require('net');
const { ENV } = require('./config');
const { describeInstance } = require('./ecs');

function rconPacket(id, type, payload) {
  const p = Buffer.from(payload, 'utf8');
  const body = Buffer.alloc(8 + p.length + 2);
  body.writeInt32LE(id, 0);
  body.writeInt32LE(type, 4);
  p.copy(body, 8);
  const out = Buffer.alloc(4 + body.length);
  out.writeInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
}
function parseRcon(buf) {
  const pkts = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const len = buf.readInt32LE(i);
    if (len < 8) break;
    if (i + 4 + len > buf.length) break;
    pkts.push({ id: buf.readInt32LE(i + 4), type: buf.readInt32LE(i + 8), payload: buf.slice(i + 12, i + 4 + len - 2).toString('utf8') });
    i += 4 + len;
  }
  return { pkts, consumed: i };
}
function rcon(host, port, password, command, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    let buf = Buffer.alloc(0);
    const AUTH_ID = 100, CMD_ID = 101;
    const done = (o) => { if (!s.destroyed) s.destroy(); resolve(o); };
    s.on('error', (e) => done({ ok: false, reason: e.code || e.message }));
    s.on('timeout', () => done({ ok: false, reason: 'timeout ' + timeoutMs + 'ms' }));
    s.on('connect', () => s.write(rconPacket(AUTH_ID, 2, password)));
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { pkts, consumed } = parseRcon(buf);
      if (consumed) buf = buf.slice(consumed);
      for (const p of pkts) {
        if (p.id === AUTH_ID) {
          if (p.type === 3) { done({ ok: false, reason: 'RCON 认证失败（密码错或未启用 RCON）' }); return; }
          s.write(rconPacket(CMD_ID, 0, command));
        } else if (p.id === CMD_ID) {
          done({ ok: true, output: p.payload });
          return;
        }
      }
    });
  });
}

/** 执行一条 MC 指令。q.cmd = 指令文本。 */
async function mccmd(q) {
  const cmd = String(q.cmd || '').trim();
  if (!cmd) return { ok: false, msg: '缺少 cmd（MC 指令）' };
  if (cmd.length > 300) return { ok: false, msg: '指令过长' };
  const info = await describeInstance().catch(() => ({ status: 'Unknown', publicIp: '' }));
  if (info.status !== 'Running' || !info.publicIp) return { ok: false, msg: 'ECS 未运行或无公网 IP，无法连接 RCON' };
  if (!ENV.MC_RCON_PASSWORD) return { ok: false, msg: '未配置 MC_RCON_PASSWORD（需在 server.properties 启用 RCON）' };
  const r = await rcon(info.publicIp, ENV.MC_RCON_PORT, ENV.MC_RCON_PASSWORD, cmd);
  return {
    ok: r.ok,
    command: cmd,
    target: info.publicIp + ':' + ENV.MC_RCON_PORT,
    output: r.ok ? r.output : null,
    reason: r.ok ? null : r.reason,
  };
}

module.exports = { mccmd, rcon };
