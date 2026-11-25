'use strict';
/**
 * modules/fc.js —— 阿里云函数计算 FC 3.0：函数的启用 / 禁用 / 状态查询
 *
 * 场景：函数因欠费/手动被禁用后（触发器返回 InvokeDisabled），
 *       直接在控制台点「启用函数」即可恢复，不用登录阿里云控制台。
 *
 * 用项目已有的 @alicloud/openapi-core 走 ROA 风格签名，零新增依赖。
 *   GetFunction                 GET  /2023-03-30/functions/{fn}
 *   EnableFunctionInvocation    POST /2023-03-30/functions/{fn}/invoke/enable
 *   DisableFunctionInvocation   POST /2023-03-30/functions/{fn}/invoke/disable
 */
const OpenCore = require('@alicloud/openapi-core');
const Dara = require('@darabonba/typescript');
const { ENV } = require('./config');

const ACCOUNT_ID = ENV.FC_ACCOUNT_ID || '';
const REGION = ENV.FC_REGION || 'cn-hongkong';
const FUNCTION_NAME = ENV.FC_FUNCTION_NAME || 'MCECSBot';

let _client = null;
function fcClient() {
  if (_client) return _client;
  if (!ENV.AK || !ENV.SK) throw new Error('缺少阿里云 AK/SK，无法控制 FC 函数');
  const cfg = new OpenCore.$OpenApiUtil.Config({
    accessKeyId: ENV.AK,
    accessKeySecret: ENV.SK,
    endpoint: (ACCOUNT_ID ? ACCOUNT_ID + '.' : '') + REGION + '.fc.aliyuncs.com',
    regionId: REGION,
    connectTimeout: 20000,
    readTimeout: 20000,
  });
  _client = new OpenCore.default(cfg);
  return _client;
}

/** 发一次 FC 3.0 ROA 请求 */
async function roa(action, pathname, method, body) {
  const Params = OpenCore.$OpenApiUtil.Params;
  const OpenApiRequest = OpenCore.$OpenApiUtil.OpenApiRequest;
  const params = new Params({
    action,
    version: '2023-03-30',
    protocol: 'HTTPS',
    pathname,
    method,
    authType: 'AK',
    style: 'ROA',
    reqBodyType: 'json',
    bodyType: 'json',
  });
  const req = body
    ? new OpenApiRequest({ body: OpenCore.OpenApiUtil.parseToMap(body) })
    : new OpenApiRequest({});
  return fcClient().callApi(params, req, new Dara.RuntimeOptions({}));
}

const FN_PATH = () => '/2023-03-30/functions/' + encodeURIComponent(FUNCTION_NAME);

/** 查询函数调用状态：disabled=true 表示处于 InvokeDisabled（禁止调用） */
async function status() {
  const r = await roa('GetFunction', FN_PATH(), 'GET');
  const b = r.body || {};
  const ir = b.invocationRestriction || {};
  return {
    ok: true,
    functionName: b.functionName || FUNCTION_NAME,
    region: REGION,
    disabled: ir.disable === true,
    reason: ir.reason || '',
    lastModifiedTime: ir.lastModifiedTime || b.lastModifiedTime || '',
    runtime: b.runtime || '',
    timeout: b.timeout,
    msg: ir.disable === true ? '函数已禁用（禁止调用）' : '函数正常（允许调用）',
  };
}

/** 启用函数（允许调用），恢复因欠费/手动被禁用的函数 */
async function enable() {
  await roa('EnableFunctionInvocation', FN_PATH() + '/invoke/enable', 'POST');
  return { ok: true, msg: '函数已启用：' + FUNCTION_NAME + '（允许调用）' };
}

/** 禁用函数（禁止调用）；可选 reason 写入禁用原因 */
async function disable(q) {
  const reason = String((q && q.reason) || '').slice(0, 200) || 'disabled from ECS console';
  await roa('DisableFunctionInvocation', FN_PATH() + '/invoke/disable', 'POST', { reason });
  return { ok: true, msg: '函数已禁用：' + FUNCTION_NAME + '（禁止调用）' };
}

module.exports = { status, enable, disable };
