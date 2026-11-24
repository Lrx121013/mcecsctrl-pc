'use strict';
/**
 * modules/probe.js —— 模块4：宕机探活（TCP 连 PROBE_PORT，只报警不自动重启，手动触发）
 * 手动点"探活"；连不上时告警显示在网页终端（红色）。
 */
const net = require('net');
const { ENV } = require('./config');
const { describeInstance } = require('./ecs');

function tcpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const s = net.connect({ host, port, timeout: timeoutMs });
    const finish = (o) => { if (done) return; done = true; s.destroy(); resolve(o); };
    s.on('connect', () => finish({ alive: true }));
    s.on('timeout', () => finish({ alive: false, reason: 'timeout ' + timeoutMs + 'ms' }));
    s.on('error', (e) => finish({ alive: false, reason: e.code || e.message }));
    s.on('close', () => { if (!done) finish({ alive: false, reason: 'closed' }); });
  });
}

async function probe() {
  let info;
  try {
    info = await describeInstance();
  } catch (e) {
    return { ok: false, msg: '取实例状态失败：' + e.message };
  }
  const out = {
    ok: true,
    status: info.status,
    publicIp: info.publicIp,
    serviceAlive: null, reason: null, alert: null, port: ENV.PROBE_PORT,
    // MCS 管理器端口（默认 23333）
    mcsPort: ENV.MCS_MANAGER_PORT, mcsAlive: null, mcsReason: null,
  };
  if (info.status !== 'Running') { out.reason = '实例未 Running（' + info.status + '），跳过探活'; return out; }
  if (!info.publicIp) { out.reason = '实例 Running 但无公网 IP（内网/未分配），无法探活'; return out; }

  // 探两个口：MC 服务口 + MCS 管理器口（并行）
  const [p, m] = await Promise.all([
    tcpProbe(info.publicIp, ENV.PROBE_PORT),
    ENV.MCS_MANAGER_PORT ? tcpProbe(info.publicIp, ENV.MCS_MANAGER_PORT) : { alive: null, reason: '未配置' },
  ]);
  out.serviceAlive = p.alive;
  out.reason = p.alive ? 'MC 服务可达 ' + info.publicIp + ':' + ENV.PROBE_PORT : (p.reason || 'refused');
  out.mcsAlive = m.alive;
  out.mcsReason = m.alive ? 'MCS 管理器可达 ' + info.publicIp + ':' + ENV.MCS_MANAGER_PORT : (m.reason || 'refused');
  if (!p.alive) out.alert = 'MC 服务 DOWN：' + info.publicIp + ':' + ENV.PROBE_PORT + ' 连不上（' + (p.reason || 'refused') + '）';
  else if (!m.alive && m.alive !== null) out.alert = (out.alert ? out.alert + '；' : '') + 'MCS 管理器不可达：' + info.publicIp + ':' + ENV.MCS_MANAGER_PORT + '（' + (m.reason || 'refused') + '）';
  return out;
}

module.exports = { probe, tcpProbe };
