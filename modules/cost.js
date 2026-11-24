'use strict';
/**
 * modules/cost.js —— 模块3：费用看板（简化版：只显示"你账号的余额"，不复杂）
 * 余额走 BSS QueryAccountBalance；< 5 元 → lowBalance=true，前端红色闪烁。
 * 拿不到（如 BSS 端点/版本不匹配）→ 优雅降级为"获取失败"，不影响其它模块。
 */
const { ENV, openapiRPC } = require('./config');

/** 账户余额（BSS 费用中心）。 */
async function bssBalance() {
  const r = await openapiRPC({
    endpoint: ENV.BSS_ENDPOINT,
    version: ENV.BSS_VERSION,
    action: 'QueryAccountBalance',
    query: {},
  });
  const num = r && (r.AvailableAmount !== undefined ? r.AvailableAmount : r.Data && r.Data.AvailableAmount);
  const cur = r && (r.Currency || (r.Data && r.Data.Currency)) || 'CNY';
  const n = parseFloat(num);
  return { ok: true, availableAmount: isFinite(n) ? n : null, currency: cur };
}

async function cost() {
  const out = { ok: true, balance: null, lowBalance: false };
  try {
    out.balance = await bssBalance();
    out.lowBalance = out.balance.availableAmount != null && out.balance.availableAmount < 5;
  } catch (e) {
    out.balance = { ok: false, msg: e.message };
    out.lowBalance = false;
  }
  return out;
}

module.exports = { cost, bssBalance };
