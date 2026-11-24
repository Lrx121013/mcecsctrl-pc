'use strict';
/**
 * modules/cloudflare.js —— Cloudflare A 记录幂等同步
 * 原 index.js 的 Cloudflare 逻辑迁出。proxied=false（灰色云，直指真实 ECS IP）。
 */
const { ENV } = require('./config');

function cfHeaders() {
  return { Authorization: 'Bearer ' + ENV.CF_TOKEN, 'Content-Type': 'application/json' };
}

/** 取某条 A 记录，不存在返回 null。 */
async function fetchCfRecord() {
  const base = 'https://api.cloudflare.com/client/v4/zones/' + ENV.CF_ZONE + '/dns_records';
  const listUrl = base + '?type=A&name=' + encodeURIComponent(ENV.CF_RECORD);
  const r = await fetch(listUrl, { headers: cfHeaders() });
  const j = await r.json();
  if (!j.success) throw new Error('Cloudflare 记录查询失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'unknown'));
  return (j.result || []).find((x) => x.name === ENV.CF_RECORD) || null;
}

/**
 * 幂等同步 CF_RECORD 的 A 记录到 newIp。
 * 内容相同则跳过；不同则 PUT；不存在则 POST。
 */
async function ensureDnsARecord(newIp) {
  if (!ENV.CF_TOKEN || !ENV.CF_ZONE || !ENV.CF_RECORD) {
    return { ok: false, skipped: true, msg: '未配置 Cloudflare 环境变量，已跳过 DNS 同步' };
  }
  if (!newIp) return { ok: false, skipped: true, msg: '暂无公网 IP，无法同步 DNS' };

  const base = 'https://api.cloudflare.com/client/v4/zones/' + ENV.CF_ZONE + '/dns_records';
  const existing = await fetchCfRecord();
  if (existing && existing.content === newIp) {
    return { ok: true, skipped: true, action: 'unchanged', msg: 'DNS 已是最新（' + newIp + '），无需更新' };
  }

  const payload = { type: 'A', name: ENV.CF_RECORD, content: newIp, proxied: false, ttl: 120 };
  let r, j;
  if (existing) {
    r = await fetch(base + '/' + existing.id, { method: 'PUT', headers: cfHeaders(), body: JSON.stringify(payload) });
    j = await r.json();
    if (!r.ok || !j.success) return { ok: false, action: 'update-failed', msg: '更新 A 记录失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status) };
    return { ok: true, action: 'updated', msg: 'DNS 已更新 ' + ENV.CF_RECORD + ' -> ' + newIp };
  }
  r = await fetch(base, { method: 'POST', headers: cfHeaders(), body: JSON.stringify(payload) });
  j = await r.json();
  if (!r.ok || !j.success) return { ok: false, action: 'create-failed', msg: '创建 A 记录失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status) };
  return { ok: true, action: 'created', msg: '已创建 A 记录 ' + ENV.CF_RECORD + ' -> ' + newIp };
}

/** 模块8：更新指定记录名（家里设备 DDNS）到 newIp。 */
async function ensureRecord(name, newIp) {
  if (!ENV.CF_TOKEN || !ENV.CF_ZONE) return { ok: false, skipped: true, msg: '未配置 Cloudflare，无法写 DDNS' };
  if (!newIp) return { ok: false, skipped: true, msg: '未提供 myip，无法写 DDNS' };
  const base = 'https://api.cloudflare.com/client/v4/zones/' + ENV.CF_ZONE + '/dns_records';
  const listResp = await fetch(base + '?type=A&name=' + encodeURIComponent(name), { headers: cfHeaders() });
  const lj = await listResp.json();
  const existing = (lj.result || []).find((x) => x.name === name);
  if (existing && existing.content === newIp) return { ok: true, action: 'unchanged', msg: name + ' 已是最新（' + newIp + '）' };
  const payload = { type: 'A', name, content: newIp, proxied: false, ttl: 120 };
  let r, j;
  if (existing) {
    r = await fetch(base + '/' + existing.id, { method: 'PUT', headers: cfHeaders(), body: JSON.stringify(payload) });
    j = await r.json();
    return j.success ? { ok: true, action: 'updated', msg: name + ' -> ' + newIp } : { ok: false, msg: 'DDNS 更新失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status) };
  }
  r = await fetch(base, { method: 'POST', headers: cfHeaders(), body: JSON.stringify(payload) });
  j = await r.json();
  return j.success ? { ok: true, action: 'created', msg: name + ' -> ' + newIp } : { ok: false, msg: 'DDNS 创建失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status) };
}

module.exports = { ensureDnsARecord, ensureRecord, fetchCfRecord };
