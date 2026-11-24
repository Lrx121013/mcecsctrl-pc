'use strict';
/**
 * modules/ecs.js —— 模块核心：查询状态 / 开机 / 关机(节省停机) / 重启
 * 开机不卡：start 立刻返回；DNS 同步交给开/关机后前端的有界轮询触发 status。
 */
const { ENV, ecsClient } = require('./config');
const { ensureDnsARecord } = require('./cloudflare');
const { push } = require('./notify');
const Ecs = require('@alicloud/ecs20140526');

/** 查询实例状态 + 公网 IP（关机时 IP 可能已释放，逐级防空）。 */
async function describeInstance() {
  const client = ecsClient();
  const req = new Ecs.DescribeInstancesRequest({
    regionId: ENV.REGION,
    instanceIds: JSON.stringify([ENV.INSTANCE_ID]),
  });
  const resp = await client.describeInstances(req);
  const arr = (resp && resp.body && resp.body.instances && resp.body.instances.instance) || [];
  const inst = arr[0] || {};
  const publicIp =
    (inst.publicIpAddress && inst.publicIpAddress.ipAddress && inst.publicIpAddress.ipAddress[0]) ||
    (inst.eipAddress && inst.eipAddress.ipAddress) ||
    (inst.networkInterfaces &&
      inst.networkInterfaces.networkInterface &&
      inst.networkInterfaces.networkInterface[0] &&
      inst.networkInterfaces.networkInterface[0].primaryIpAddress) ||
    '';
  return {
    status: inst.status || 'Unknown',
    publicIp: publicIp || '',
    instanceId: inst.instanceId || ENV.INSTANCE_ID,
    name: inst.instanceName || '',
    region: ENV.REGION,
  };
}

/* ---- 动作处理器（被 index.js 路由调用，返回最终 JSON body） ---- */
async function status() {
  const info = await describeInstance();
  let dns = { ok: false, skipped: true, msg: '未触发' };
  let notify = null;
  if (info.status === 'Running' && info.publicIp) {
    try {
      dns = await ensureDnsARecord(info.publicIp);
      // IP 真正变化（updated/created）时，企业微信播报新 IP
      if (dns.action === 'updated' || dns.action === 'created') {
        notify = await push('公网 IP 已更新', ENV.CF_RECORD + ' -> ' + info.publicIp + '（' + info.name + '）').catch(() => null);
      }
    } catch (e) {
      dns = { ok: false, msg: 'DNS 同步异常：' + (e && e.message ? e.message : String(e)) };
    }
  }
  return { ok: true, ...info, dnsName: ENV.CF_RECORD, dns, notify };
}

async function start() {
  await ecsClient().startInstance(new Ecs.StartInstanceRequest({ instanceId: ENV.INSTANCE_ID }));
  const notify = await push('开机指令已发送', 'ECS 正在启动，拿到新 IP 后会再次播报。').catch(() => null);
  return { ok: true, action: 'start', msg: '开机指令已发送，前端每 5 秒轮询，拿到新 IP 后自动同步 Cloudflare', notify };
}

async function stop() {
  // 关键：节省停机模式，关机不计计算费用（仅按量付费实例）
  await ecsClient().stopInstance(new Ecs.StopInstanceRequest({ instanceId: ENV.INSTANCE_ID, stoppedMode: 'StopCharging' }));
  const notify = await push('关机指令已发送（节省停机）', 'ECS 已停止，关机后不产生计算费用。').catch(() => null);
  return { ok: true, action: 'stop', msg: '关机指令已发送（节省停机模式 StopCharging，关机后不产生计算费用）', notify };
}

async function restart() {
  await ecsClient().rebootInstance(new Ecs.RebootInstanceRequest({ instanceId: ENV.INSTANCE_ID }));
  const notify = await push('重启指令已发送', 'ECS 正在重启。').catch(() => null);
  return { ok: true, action: 'restart', msg: '重启指令已发送', notify };
}

async function dns() {
  const info = await describeInstance().catch(() => ({ publicIp: '', status: 'Unknown' }));
  let d;
  try {
    d = await ensureDnsARecord(info.publicIp);
  } catch (e) {
    d = { ok: false, msg: 'DNS 同步异常：' + (e && e.message ? e.message : String(e)) };
  }
  return { ok: d.ok !== false, status: info.status, publicIp: info.publicIp, dns: d };
}

module.exports = { describeInstance, status, start, stop, restart, dns };
