'use strict';
/**
 * modules/audit.js —— 模块5：SSH 防爆破 & 异地登录告警
 * 通过云助手读 /var/log/auth.log（不依赖收费的云安全中心高级版，纯白嫖）。
 * 内部生成的命令直接 runCommand，不受用户白名单限制。
 */
const { runCommand, pollResult } = require('./shell');
const { ENV } = require('./config');

const AUDIT_CMD = [
  'LOG="";',
  '[ -f /var/log/auth.log ] && LOG=/var/log/auth.log',
  '[ -f /var/log/secure ] && [ -z "$LOG" ] && LOG=/var/log/secure',
  'if [ -n "$LOG" ]; then tail -n 3000 "$LOG" | grep -aiE "Failed|Accepted|Invalid user|session opened" | tail -n 80; else echo NO_AUTH_LOG; fi',
  'echo "==ACTIVE=="',
  '(w -h 2>/dev/null || last -n 5 2>/dev/null || true)',
].join('\n');

function trustedIps() {
  return (ENV.SSH_TRUSTED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 解析 auth.log 行。 */
function parseOutput(text) {
  const failed = [];
  const accepted = [];
  const active = [];
  let zone = 0; // 0=failed/accepted, 1=active
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '==ACTIVE==') { zone = 1; continue; }
    if (zone === 1) { if (line !== 'NO_AUTH_LOG') active.push(line); continue; }
    const mFail = line.match(/Failed (?:password|publickey)[^\n]*from\s+([\d.]+|[\w-]+)/i);
    const mAcc = line.match(/Accepted \w+ ([\w-]+) from\s+([\d.]+)/i);
    if (mFail) failed.push({ src: mFail[1], raw: line });
    else if (mAcc) accepted.push({ user: mAcc[1], ip: mAcc[2], raw: line });
  }
  return { failed, accepted, active };
}

/** 统计每个来源 IP 的失败次数，找爆破源。 */
function topOffenders(failed, topN = 5) {
  const map = {};
  for (const f of failed) {
    if (f.src === 'localhost' || f.src === '(none)') continue;
    map[f.src] = (map[f.src] || 0) + 1;
  }
  return Object.keys(map)
    .map((ip) => ({ ip, count: map[ip] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

async function audit() {
  let invokeId;
  try {
    invokeId = await runCommand(AUDIT_CMD, { timeout: 60 });
  } catch (e) {
    return { ok: false, msg: '下发审计命令失败（ECS 需安装云助手 Agent）：' + e.message };
  }
  const res = await pollResult(invokeId);
  if (res.status !== 'Finished') {
    return { ok: false, msg: '审计命令未完成（' + res.status + '），' + res.output };
  }
  const { failed, accepted, active } = parseOutput(res.output);
  const offenders = topOffenders(failed);
  const threshold = 5;
  const suspicious = offenders.some((o) => o.count >= threshold);
  const trusted = trustedIps();
  const untrustedLogins = accepted.filter((a) => trusted.length > 0 && trusted.indexOf(a.ip) === -1);

  const out = {
    ok: true,
    failedCount: failed.length,
    topOffenders: offenders,
    suspicious,
    lastFailures: failed.slice(-8).map((f) => f.raw),
    logins: accepted.slice(-8).map((a) => ({ user: a.user, ip: a.ip })),
    untrustedLogins,
    active,
    invokeId,
  };
  if (suspicious || untrustedLogins.length) {
    out.alertMsg = (suspicious ? '检测到 SSH 爆破嫌疑（' + offenders[0].ip + ' 失败 ' + offenders[0].count + ' 次）' : '')
      + (untrustedLogins.length ? (suspicious ? '；' : '') + '存在非白名单 IP 登录：' + untrustedLogins.map((x) => x.ip).join(', ') : '');
  }
  return out;
}

module.exports = { audit };
