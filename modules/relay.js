'use strict';
/**
 * modules/relay.js —— 办法二「函数中继」
 * 当 MODE=function 且配了 RELAY_URL（阿里云 FC 的 HTTP 触发器）时，
 * 把"需要稳定外网"的操作（改 Cloudflare、飞书推送等）委托给那个函数执行，
 * 本地软件只需能连到 阿里云/该函数即可（学校网络也能用）。
 *
 * 启用/禁用：写 Cloudflare KV 的 relay-enabled 标志（白嫖：停用后函数 tick 不做事）。
 */
const { ENV, cfKvGet, cfKvSet } = require('./config');

const RELAY_FLAG_KEY = 'relay-enabled';

/** 是否走函数模式（且配了中继地址）。 */
function usingRelay() {
  return ENV.MODE === 'function' && !!ENV.RELAY_URL;
}

/** 委托某个操作给中继函数：GET RELAY_URL?action=<op>&secret=RELAY_SECRET&<params> */
async function relay(op, params) {
  if (!ENV.RELAY_URL) return { ok: false, msg: '未配置 RELAY_URL（把阿里云 FC 触发器地址填进去）' };
  const qs = new URLSearchParams();
  qs.set('action', op);
  qs.set('secret', ENV.RELAY_SECRET || '');
  if (params) for (const k of Object.keys(params)) if (params[k] !== undefined && params[k] !== null) qs.set(k, params[k]);
  const r = await fetch(ENV.RELAY_URL + '?' + qs.toString(), { headers: { 'Accept': 'application/json' } });
  const text = await r.text();
  if (text.trim().charAt(0) === '<') return { ok: false, msg: '中继函数返回 HTML 而非 JSON（FC 网关/域名问题）' };
  try {
    const j = JSON.parse(text);
    return Object.assign({ relay: true, op }, j);
  } catch (_) {
    return { ok: false, msg: '中继函数返回非 JSON：' + text.slice(0, 80) };
  }
}

/** 中继函数当前是否启用（读 CF KV 标志；没配 KV 则视为启用）。 */
async function relayStatus() {
  const flag = await cfKvGet(RELAY_FLAG_KEY).catch(() => null);
  const enabled = flag === null ? true : flag !== '0' && flag !== 'false';
  return { ok: true, enabled, viaRelay: usingRelay(), relayUrl: !!ENV.RELAY_URL };
}

/** 启用/禁用中继（写 CF KV 标志；停用后函数侧 tick 不做事 = 白嫖）。 */
async function relayToggle(enabled) {
  const v = enabled ? '1' : '0';
  const out = await cfKvSet(RELAY_FLAG_KEY, v).catch((e) => ({ ok: false, msg: '写标志失败：' + e.message }));
  return { ok: out.ok !== false, enabled: enabled ? v === '1' : false, msg: (enabled ? '已启用' : '已停用') + '中继（函数侧读取该标志，停用后不再做事）' };
}

module.exports = { usingRelay, relay, relayStatus, relayToggle };
