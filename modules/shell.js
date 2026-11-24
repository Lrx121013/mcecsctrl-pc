'use strict';
/**
 * modules/shell.js —— 模块7：网页一键执行系统命令（阿里云 ECS 云助手 RunCommand）
 * 用户自定义命令必须命中白名单才执行；模块5/10 内部生成的命令直接走 runCommand。
 */
const Ecs = require('@alicloud/ecs20140526');
const { ENV, ecsClient } = require('./config');

/** 内置只读安全命令前缀（CMD_ALLOWLIST 未配置时的默认白名单）。 */
const BUILTIN_ALLOWLIST = [
  'uptime', 'who', 'w ', 'whoami', 'hostname', 'uname', 'df -', 'du -', 'free -',
  'tail ', 'cat /var/log/', 'head /var/log/', 'grep -i "failed" /var/log/',
  'ps -ef', 'ps aux', 'ss -tlnp', 'systemctl status', 'docker ps', 'docker logs',
  // 定位/查看（只读，方便在网页上找 server.properties、读配置）
  'find ', 'ls ', 'grep ', 'which ', 'pwd', 'cat ', 'head ', 'docker exec ',
  'curl -s http://169.254.169.254/latest/meta-data/',
];

function allowlist() {
  if (ENV.CMD_ALLOWLIST && ENV.CMD_ALLOWLIST.trim()) {
    return ENV.CMD_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return BUILTIN_ALLOWLIST;
}

function isAllowed(cmd) {
  const list = allowlist();
  return list.some((p) => cmd.trim().startsWith(p));
}

/** 下发云助手命令，返回 InvokeId。 */
async function runCommand(commandContent, { type = 'RunShellScript', workingDir = '/', timeout = 60 } = {}) {
  const client = ecsClient();
  const req = new Ecs.RunCommandRequest({
    regionId: ENV.REGION,
    instanceId: [ENV.INSTANCE_ID],
    type,
    commandContent,
    workingDir,
    timeout,
    contentEncoding: 'PlainText',
  });
  const resp = await client.runCommand(req);
  return resp.body.invokeId;
}

/** 轮询云助手执行结果（output 为 base64）。 */
async function pollResult(invokeId, { tries = 20, waitMs = 1500 } = {}) {
  const client = ecsClient();
  for (let i = 0; i < (tries || 20); i++) {
    const resp = await client.describeInvocationResults(
      new Ecs.DescribeInvocationResultsRequest({ regionId: ENV.REGION, invokeId, instanceId: [ENV.INSTANCE_ID] })
    );
    const results = (resp.body && resp.body.invocation && resp.body.invocationResults && resp.body.invocationResults.invocationResult) || [];
    const r = results[0];
    if (r) {
      const st = r.status;
      if (['Finished', 'Failed', 'Stopped', 'Timeout', 'Error', 'PartialFailed'].indexOf(st) > -1) {
        let output = '';
        try { output = Buffer.from(r.output || '', 'base64').toString('utf8'); } catch (e) { output = r.output || ''; }
        return { status: st, exitCode: r.exitCode, output: output.slice(0, 20000), invokeId };
      }
    }
    await new Promise((res) => setTimeout(res, waitMs || 1500));
  }
  return { status: 'Timeout', exitCode: null, output: '', invokeId };
}

/** 动作处理器：执行用户提供的命令（必须命中白名单）。 */
async function exec(q) {
  const cmd = (q.cmd || '').trim();
  if (!cmd) return { ok: false, msg: '缺少 cmd 参数' };
  if (!isAllowed(cmd)) {
    return { ok: false, msg: '命令未命中白名单，已拒绝。允许的白名单：' + allowlist().join(' | ') };
  }
  const invokeId = await runCommand(cmd, { timeout: q.timeout ? parseInt(q.timeout, 10) : 60 });
  const res = await pollResult(invokeId);
  return {
    ok: res.status === 'Finished',
    status: res.status,
    exitCode: res.exitCode,
    output: res.output,
    invokeId: res.invokeId,
    msg: res.status === 'Finished' ? '命令执行完成' : '命令执行状态：' + res.status,
  };
}

module.exports = { exec, runCommand, pollResult, isAllowed, allowlist };
