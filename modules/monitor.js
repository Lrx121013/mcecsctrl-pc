'use strict';
/**
 * modules/monitor.js —— 模块6：服务器实时监控面板（CPU/内存/带宽 + CPU 近 1h 曲线）
 * 数据来自云监控 CMS，免费。前端用纯 CSS 进度条 / 迷你曲线渲染。
 */
const { cmsLast, cmsList } = require('./cms');

async function monitor() {
  const out = { ok: true, metrics: {}, series: { cpu: [] }, ts: Date.now() };
  const defs = [
    ['cpu', 'CPUUtilization'],
    ['mem', 'memory_usedutilization'],
    ['netOut', 'net_out'],
    ['netIn', 'net_in'],
  ];
  for (const [k, m] of defs) {
    try {
      const d = await cmsLast(m);
      out.metrics[k] = d && d.value != null ? d.value : null;
    } catch (e) {
      out.metrics[k] = null;
    }
  }
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 3600 * 1000);
    const list = await cmsList('CPUUtilization', { start, end: now, period: '60', length: 60 });
    out.series.cpu = list.map((p) => (p.value != null ? p.value : 0));
  } catch (e) {
    /* 序列拿不到不影响主数据 */
  }
  return out;
}

module.exports = { monitor };
