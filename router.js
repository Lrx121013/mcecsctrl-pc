'use strict';
/**
 * router.js —— 框架无关的核心路由（桌面 / EdgeOne 通用）
 * handle(query, method) → { status, body, contentType }
 * 权限：只读（无密码）/ 管理员（ACCESS_PASSWORD）/ 系统 scheduler（SCHEDULER_SECRET）。
 */
const { ENV } = require('./modules/config');
const mEcs = require('./modules/ecs');
const mNotify = require('./modules/notify');
const mCost = require('./modules/cost');
const mProbe = require('./modules/probe');
const mMonitor = require('./modules/monitor');
const mShell = require('./modules/shell');
const mAudit = require('./modules/audit');
const mMc = require('./modules/mc');
const mMccmd = require('./modules/mccmd');
const mSchedule = require('./modules/schedule');
const mRelay = require('./modules/relay');
const mFc = require('./modules/fc');

const READONLY = ['status', 'monitor', 'mc', 'cost', 'schedule', 'relay-status', 'fc-status'];
const ADMIN = ['start', 'stop', 'restart', 'dns', 'exec', 'mccmd', 'probe', 'audit', 'schedule-set', 'notify-test', 'relay', 'relay-toggle', 'fc-enable', 'fc-disable'];
const SYSTEM = ['scheduler'];
const API_ACTIONS = [].concat(READONLY, ADMIN, SYSTEM, ['check', 'ping']);

const HANDLERS = {
  check: (q) => (ENV.PASSWORD && q.password === ENV.PASSWORD ? { ok: true, msg: 'AUTH_OK' } : { ok: false, code: 401, msg: '密码错误' }),
  ping: () => ({ ok: true, msg: 'pong' }),
  status: mEcs.status,
  monitor: mMonitor.monitor,
  mc: mMc.mc,
  cost: mCost.cost,
  schedule: mSchedule.getSchedule,
  start: mEcs.start,
  stop: mEcs.stop,
  restart: mEcs.restart,
  dns: mEcs.dns,
  exec: (q) => mShell.exec(q),
  mccmd: (q) => mMccmd.mccmd(q),
  probe: mProbe.probe,
  audit: mAudit.audit,
  'schedule-set': (q) => mSchedule.setSchedule(q),
  'notify-test': mNotify.test,
  scheduler: (q) => mSchedule.schedulerTick(q),

  // 办法二：函数中继
  'relay-status': mRelay.relayStatus,
  'relay-toggle': (q) => mRelay.relayToggle(q.enabled === '1' || q.enabled === 'true'),
  relay: (q) => mRelay.relay(String(q.op || ''), q),

  // FC 函数启停（启用/禁用中继函数本身）
  'fc-status': mFc.status,
  'fc-enable': mFc.enable,
  'fc-disable': (q) => mFc.disable(q),
};

function json(obj, status) {
  return { status: status || 200, body: JSON.stringify(obj), contentType: 'application/json' };
}

async function handle(rawQuery, method) {
  try {
    const q = Object.assign({}, rawQuery || {});
    const action = String(q.action || '').toLowerCase();

    if (API_ACTIONS.indexOf(action) === -1) return json({ ok: false, code: 400, msg: '缺少 action 参数' }, 400);

    if (ADMIN.indexOf(action) > -1) {
      if (ENV.PASSWORD === '' || q.password !== ENV.PASSWORD) {
        return json({ ok: false, code: 401, msg: '认证失败：需要管理员密码' }, 401);
      }
    }
    const handler = HANDLERS[action];
    if (!handler) return json({ ok: false, code: 400, msg: '未知 action：' + action }, 400);

    const body = await handler(q);
    return json(body, (body && body.code) || 200);
  } catch (e) {
    return json({ ok: false, code: 500, msg: '处理失败：' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

module.exports = { handle, API_ACTIONS };
