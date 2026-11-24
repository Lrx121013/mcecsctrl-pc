'use strict';
/**
 * modules/schedule.js —— 模块1：定时自动开关机（管理员可完全自定义，持久化到 Cloudflare KV）
 *
 * 工作机制（白嫖）：
 *   - FC 控制台加一个"每分钟"定时触发器，载荷 {"action":"scheduler","secret":"<SCHEDULER_SECRET>"}
 *   - 每次 tick 读 CF KV 的 ecs-console:schedule（未保存计划则不触发，不烧钱）。
 *     只在"到点且今天没做过"时发 start/stop，并回写 lastStart/lastStop 防止重复。
 *   - 空计划/关闭 = 该 tick 只读一次 KV 就返回，几乎不烧 CU。
 */
const Ecs = require('@alicloud/ecs20140526');
const { ENV, ecsClient, cfKvGet, cfKvSet } = require('./config');

const KV_KEY = 'ecs-console:schedule';

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  const out = days.map((d) => parseInt(d, 10)).filter((d) => d >= 1 && d <= 7);
  return out;
}
function normTime(t) { return t === '24:00' ? '00:00' : t; }

/** 载入计划：只从 Cloudflare KV 读（MCECSConsole）。没有 KV / 未保存 → 无计划。 */
async function loadSchedule() {
  const raw = await cfKvGet(KV_KEY).catch(() => null);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      s.days = normalizeDays(s.days);
      s.lastStart = s.lastStart || '';
      s.lastStop = s.lastStop || '';
      s.source = 'kv';
      return s;
    } catch (e) {
      return null;
    }
  }
  return null;
}

/** 读取当前计划（只读，网页展示用）。 */
async function getSchedule() {
  const s = await loadSchedule();
  return {
    ok: true,
    schedule: s,
    kvConfigured: !!(ENV.CF_ACCOUNT_ID && ENV.CF_KV_NAMESPACE && ENV.CF_TOKEN),
    source: s ? s.source : 'none',
  };
}

/** 管理员保存计划（写 CF KV；未配 KV 则提示用环境变量）。 */
async function setSchedule(q) {
  const s = {
    enabled: q.enabled !== 'false',
    startAt: normTime(q.startAt || '08:00'),
    stopAt: normTime(q.stopAt || '22:00'),
    days: normalizeDays(String(q.days || '').split(',')),
    tz: q.tz || 'Asia/Shanghai',
  };
  if (!/^\d{1,2}:\d{2}$/.test(s.startAt) || !/^\d{1,2}:\d{2}$/.test(s.stopAt)) {
    return { ok: false, msg: '时间格式需为 HH:MM' };
  }
  const r = await cfKvSet(KV_KEY, JSON.stringify(s));
  if (!r.ok) return { ok: false, msg: r.msg };
  return { ok: true, schedule: s, msg: '定时计划已保存到 Cloudflare KV' };
}

/** 每分钟定时触发器调用：到点发 start/stop。 */
async function schedulerTick(q) {
  if (!ENV.SCHEDULER_SECRET || q.secret !== ENV.SCHEDULER_SECRET) {
    return { ok: false, msg: 'SCHEDULER_SECRET 不匹配，拒绝执行' };
  }
  const s = await loadSchedule();
  if (!s || s.enabled !== true && s.enabled !== 'true') return { ok: true, action: 'none', msg: '无启用的定时计划' };

  const tz = s.tz || 'Asia/Shanghai';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => {
    const p = parts.find((x) => x.type === t);
    return p ? p.value : null;
  };
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const hhmm = `${get('hour')}:${get('minute')}`;
  const isoDay = (() => { const d = now.getDay(); return d === 0 ? 7 : d; })(); // 1=Mon..7=Sun

  const days = normalizeDays(s.days);
  const dayOk = days.length === 0 || days.indexOf(isoDay) > -1;

  let did = null;
  if (dayOk) {
    if (hhmm === s.startAt && s.lastStart !== today) {
      await ecsClient().startInstance(new Ecs.StartInstanceRequest({ instanceId: ENV.INSTANCE_ID }));
      did = 'start';
    }
    if (hhmm === s.stopAt && s.lastStop !== today) {
      await ecsClient().stopInstance(new Ecs.StopInstanceRequest({ instanceId: ENV.INSTANCE_ID, stoppedMode: 'StopCharging' }));
      did = 'stop';
    }
  }
  if (did) {
    s.lastStart = did === 'start' ? today : s.lastStart;
    s.lastStop = did === 'stop' ? today : s.lastStop;
    await cfKvSet(KV_KEY, JSON.stringify(s)).catch(() => {});
  }
  return { ok: true, action: did || 'none', now: hhmm, today: today, tz: tz, dayOk: dayOk };
}

module.exports = { getSchedule, setSchedule, schedulerTick, loadSchedule };
