'use strict';
/**
 * modules/config.js —— 共享配置与通用工具
 * ENV 集中读取、ECS 客户端、通用 OpenAPI RPC（BSS/CMS）、JSON/HTML 响应、query 归一化。
 */
const fs = require('fs');
const path = require('path');

const Ecs = require('@alicloud/ecs20140526');
const OpenApi = require('@alicloud/openapi-client'); // 老一代 Config，给 ECS 客户端用（已验证可用）
const OpenCore = require('@alicloud/openapi-core');   // 新一代 base，给通用 RPC（BSS/CMS）用
const Dara = require('@darabonba/typescript');         // RuntimeOptions

/* ---------------- ENV ---------------- */
const ENV = {
  AK: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || '',
  SK: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || '',
  INSTANCE_ID: process.env.ECS_INSTANCE_ID || '',
  REGION: process.env.ECS_REGION_ID || 'cn-hangzhou',
  CF_TOKEN: process.env.CF_API_TOKEN || '',
  CF_ZONE: process.env.CF_ZONE_ID || '',
  CF_RECORD: process.env.CF_RECORD_NAME || '',
  PASSWORD: process.env.ACCESS_PASSWORD || '',

  // 功能项
  PROBE_PORT: parseInt(process.env.PROBE_PORT || '25565', 10), // 模块4 探活端口
  MC_PORT: parseInt(process.env.MC_PORT || '25565', 10),      // 模块9 MC 端口
  CMD_ALLOWLIST: process.env.CMD_ALLOWLIST || '',         // 模块7 允许命令前缀，逗号分隔
  SSH_TRUSTED_IPS: process.env.SSH_TRUSTED_IPS || '',     // 模块5 受信登录 IP，逗号分隔
  MC_RCON_PORT: parseInt(process.env.MC_RCON_PORT || '25575', 10), // MC RCON 端口（MC 指令模式）
  MC_RCON_PASSWORD: process.env.MC_RCON_PASSWORD || '',   // MC RCON 密码
  // 模块2 飞书（Feishu/Lark）自建应用推送（纯 HTTPS，FC 友好）
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',         // 飞书应用 App ID（cli_...）
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '', // 飞书应用 App Secret
  FEISHU_RECEIVE_ID: process.env.FEISHU_RECEIVE_ID || '', // 目标：群 chat_id(oc_...) 或 用户 open_id(ou_...)；留空=自动取第一个群
  FEISHU_RECEIVE_TYPE: process.env.FEISHU_RECEIVE_TYPE || '', // chat_id / open_id，留空自动判断
  // 桌面版 / 函数中继
  MCS_MANAGER_PORT: parseInt(process.env.MCS_MANAGER_PORT || '23333', 10), // MCS 管理器端口（探测+显示）
  MODE: process.env.MODE || 'direct',      // 'direct'=直连 / 'function'=走中继函数
  RELAY_URL: process.env.RELAY_URL || '',       // 函数中继：阿里云 FC 的 HTTP 触发器地址
  RELAY_SECRET: process.env.RELAY_SECRET || '',  // 函数中继：调用该函数时带的密钥（防他人）

  // 定时开关机：计划统一存 Cloudflare KV（CF_KV_NAMESPACE 填命名空间名字 MCECSConsole 即可，也接受 ID）
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || '',
  CF_KV_NAMESPACE: process.env.CF_KV_NAMESPACE || '',   // 命名空间名字（如 MCECSConsole）或 ID
  SCHEDULER_SECRET: process.env.SCHEDULER_SECRET || '', // 必须与定时触发器载荷里的 secret 完全一致

  // 模块3/6 端点/版本（内置常量，一般不用改；取不到会优雅降级，不影响其它模块）
  BSS_ENDPOINT: 'business.aliyuncs.com',
  BSS_VERSION: '2017-12-10',
  CMS_ENDPOINT: 'metrics.' + (process.env.ECS_REGION_ID || 'cn-hangzhou') + '.aliyuncs.com',
  CMS_VERSION: '2019-01-21',
};

/* ---------------- ECS 客户端 ---------------- */
let _ecs = null;
function ecsClient() {
  if (_ecs) return _ecs;
  if (!ENV.AK || !ENV.SK) throw new Error('缺少阿里云 AK/SK 环境变量');
  if (!ENV.INSTANCE_ID) throw new Error('缺少 ECS_INSTANCE_ID 环境变量');
  const cfg = new OpenApi.Config({
    accessKeyId: ENV.AK,
    accessKeySecret: ENV.SK,
    regionId: ENV.REGION,
    endpoint: 'ecs.' + ENV.REGION + '.aliyuncs.com',
    connectTimeout: 30000,
    readTimeout: 30000,
  });
  _ecs = new Ecs.default(cfg);
  return _ecs;
}

/* ---------------- 通用 RPC（BSS / CMS 等无独立 JS SDK 的服务） ---------------- */
const _rpcClients = {};
function rpcClient(endpoint, region) {
  const key = endpoint + '|' + (region || ENV.REGION);
  if (_rpcClients[key]) return _rpcClients[key];
  if (!ENV.AK || !ENV.SK) throw new Error('缺少阿里云 AK/SK 环境变量');
  const cfg = new OpenCore.$OpenApiUtil.Config({
    accessKeyId: ENV.AK,
    accessKeySecret: ENV.SK,
    endpoint,
    regionId: region || ENV.REGION,
    connectTimeout: 15000,
    readTimeout: 15000,
  });
  const c = new OpenCore.default(cfg);
  _rpcClients[key] = c;
  return c;
}

/**
 * 发起一次阿里云 RPC 调用（走 openapi-core，与官方 ECS SDK 同基座）。
 * @returns Promise<any>  解析后的响应 body
 */
async function openapiRPC({ endpoint, version, action, query = {}, region, style = 'RPC' }) {
  const c = rpcClient(endpoint, region);
  const params = new OpenCore.$OpenApiUtil.Params({
    action,
    version,
    protocol: 'HTTPS',
    pathname: '/',
    method: 'POST',
    authType: 'AK',
    style,
    reqBodyType: 'formData',
    bodyType: 'json',
  });
  const q = OpenCore.OpenApiUtil && OpenCore.OpenApiUtil.query ? OpenCore.OpenApiUtil.query(query) : query;
  const req = new OpenCore.$OpenApiUtil.OpenApiRequest({ query: q });
  const runtime = new Dara.RuntimeOptions({});
  return c.callApi(params, req, runtime);
}

/* ---------------- Cloudflare KV（定时计划持久化；免费额度） ---------------- */
const kvAuth = { Authorization: 'Bearer ' + ENV.CF_TOKEN, 'Content-Type': 'application/json' };

/** 读 KV 值（不存在/未配置返回 null）。 */
async function cfKvGet(key) {
  if (!ENV.CF_ACCOUNT_ID || !ENV.CF_KV_NAMESPACE || !ENV.CF_TOKEN) return null;
  const url =
    'https://api.cloudflare.com/client/v4/accounts/' +
    ENV.CF_ACCOUNT_ID +
    '/kv/namespaces/' +
    ENV.CF_KV_NAMESPACE +
    '/values/' +
    encodeURIComponent(key);
  const r = await fetch(url, { headers: kvAuth });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  return j.success ? j.result : null;
}

/** 写 KV 值。未配置 KV 时返回 skipped。 */
async function cfKvSet(key, value) {
  if (!ENV.CF_ACCOUNT_ID || !ENV.CF_KV_NAMESPACE || !ENV.CF_TOKEN) {
    return { ok: false, skipped: true, msg: '未配置 CF_ACCOUNT_ID / CF_KV_NAMESPACE，无法写入 KV（定时计划仅存内存/环境变量）' };
  }
  const url =
    'https://api.cloudflare.com/client/v4/accounts/' +
    ENV.CF_ACCOUNT_ID +
    '/kv/namespaces/' +
    ENV.CF_KV_NAMESPACE +
    '/keys/' +
    encodeURIComponent(key);
  const r = await fetch(url, { method: 'PUT', headers: kvAuth, body: JSON.stringify({ value: String(value) }) });
  const j = await r.json().catch(() => ({}));
  return j.success
    ? { ok: true }
    : { ok: false, msg: 'KV 写入失败：' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status) };
}

/* ---------------- 响应 & query 工具（原 index.js 迁出） ---------------- */
function jsonResponse(obj, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(obj),
  };
}

function htmlResponse() {
  let body = '';
  try {
    body = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  } catch (e) {
    body = '<pre>index.html not found in the code package.</pre>';
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

/** 归一化 query（HTTP 触发器 queryStringParameters + 定时触发器事件体兜底）。 */
function normalizeQuery(req) {
  const out = {};
  const raw =
    req.queryStringParameters || req.queryParameters || req.queryString || req.query || '';
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) out[String(k).toLowerCase()] = Array.isArray(raw[k]) ? raw[k][0] : raw[k];
  } else if (typeof raw === 'string' && raw) {
    const qs = raw.charAt(0) === '?' ? raw.slice(1) : raw;
    try {
      const sp = new URLSearchParams(qs);
      for (const [k, v] of sp) out[k.toLowerCase()] = v;
    } catch (_) {}
  }
  // 兜底：从 path 里解析
  const p = req.path || req.requestPath || '';
  const qi = p.indexOf('?');
  if (qi > -1) {
    try {
      const sp = new URLSearchParams(p.slice(qi + 1));
      for (const [k, v] of sp) if (!(k.toLowerCase() in out)) out[k.toLowerCase()] = v;
    } catch (_) {}
  }
  // 兜底：定时触发器 —— 事件体本身携带 action / password / secret
  if (!out.action) out.action = String(req.action || '').toLowerCase();
  if (out.password === undefined) out.password = req.password || '';
  if (out.secret === undefined) out.secret = req.secret || '';
  return out;
}

module.exports = { ENV, ecsClient, openapiRPC, cfKvGet, cfKvSet, jsonResponse, htmlResponse, normalizeQuery };
