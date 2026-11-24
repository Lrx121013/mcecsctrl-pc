'use strict';
/**
 * modules/notify.js —— 模块2：飞书（Feishu/Lark）自建应用推送
 * 纯 HTTPS（gettenant_access_token → im/v1/messages），FC 友好，无可信IP / 无接收服务器。
 * 目标：FEISHU_RECEIVE_ID（群 chat_id 或 用户 open_id）；留空则自动取机器人所在第一个群。
 */
const { ENV } = require('./config');

let _tok = { token: '', exp: 0 };
async function feishuToken() {
  if (_tok.token && Date.now() < _tok.exp) return _tok.token;
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.tenant_access_token) throw new Error('飞书 gettenant 失败：' + (j.msg || 'code ' + j.code));
  _tok = { token: j.tenant_access_token, exp: Date.now() + (j.expire || 7200) * 1000 - 60000 };
  return j.tenant_access_token;
}

/** 未显式配 FEISHU_RECEIVE_ID 时，自动取机器人所在第一个群 chat_id。 */
async function resolveFeishuTarget() {
  if (ENV.FEISHU_RECEIVE_ID) {
    const id = ENV.FEISHU_RECEIVE_ID;
    const type = ENV.FEISHU_RECEIVE_TYPE || (id.indexOf('oc_') === 0 ? 'chat_id' : 'open_id');
    return { receiveId: id, receiveType: type };
  }
  const token = await feishuToken();
  const r = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=10', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  const arr = (j.code === 0 && j.data && j.data.items) || [];
  if (arr[0]) return { receiveId: arr[0].chat_id, receiveType: 'chat_id' };
  return null;
}

async function notifyFeishu(title, body) {
  if (!ENV.FEISHU_APP_ID || !ENV.FEISHU_APP_SECRET) {
    return { ok: false, skipped: true, msg: '未配置飞书 FEISHU_APP_ID / FEISHU_APP_SECRET，跳过推送' };
  }
  const target = await resolveFeishuTarget();
  if (!target) {
    return { ok: false, msg: '飞书机器人还没加进任何群，也没配 FEISHU_RECEIVE_ID。请把机器人拉进一个飞书群，或填 FEISHU_RECEIVE_ID（群 chat_id / 用户 open_id）' };
  }
  const token = await feishuToken();
  const content = '【ECS·CTRL】' + title + (body ? '\n' + body : '');
  const r = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=' + target.receiveType, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ receive_id: target.receiveId, msg_type: 'text', content: JSON.stringify({ text: content }) }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.code === 0) return { ok: true, msg: '已推送到飞书（' + target.receiveType + ' ' + target.receiveId + '）' };
  return { ok: false, msg: '飞书推送失败：' + (j.msg || '') + ' (code ' + j.code + ')。需应用已开通"发消息"权限且目标在可用范围内' };
}

/** 统一推送入口：飞书。失败不抛错、不影响主流程。 */
async function push(title, body) {
  try {
    return await notifyFeishu(title, body);
  } catch (e) {
    return { ok: false, msg: '推送异常：' + (e && e.message ? e.message : String(e)) };
  }
}

/** 动作处理器：测试推送（前端"推送测试" / ?action=notify-test）。 */
async function test() {
  const r = await push('推送通道测试', '推送通道（飞书）正常。时间 ' + new Date().toLocaleString('zh-CN'));
  return { ok: r.ok, msg: r.msg };
}

module.exports = { notifyFeishu, push, test };
