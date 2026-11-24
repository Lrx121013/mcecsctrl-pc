'use strict';
/**
 * modules/cms.js —— 云监控（CMS）通用查询（模块3/6 共用）
 * 走通用 openapiRPC，无独立 SDK。
 */
const { ENV, openapiRPC } = require('./config');

const endpoint = () => ENV.CMS_ENDPOINT;
const VERSION = () => ENV.CMS_VERSION;

function parseData(resp) {
  let d = resp && resp.Data;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) { d = []; }
  }
  return Array.isArray(d) ? d : [];
}

/** 取指标最新一个点。 */
async function cmsLast(metric, period = '60') {
  const r = await openapiRPC({
    endpoint: endpoint(),
    version: VERSION(),
    action: 'DescribeMetricLast',
    query: {
      Namespace: 'acs_ecs_dashboard',
      MetricName: metric,
      Dimensions: JSON.stringify([{ instanceId: ENV.INSTANCE_ID }]),
      Period: period,
    },
  });
  const arr = parseData(r);
  return arr.length ? arr[arr.length - 1] : null;
}

/** 取一段时间序列。start/end 为 Date；period 秒。 */
async function cmsList(metric, { start, end, period = '60', length = 100 } = {}) {
  const fmt = (d) => d.toISOString().replace('.000', '');
  const r = await openapiRPC({
    endpoint: endpoint(),
    version: VERSION(),
    action: 'DescribeMetricList',
    query: {
      Namespace: 'acs_ecs_dashboard',
      MetricName: metric,
      Dimensions: JSON.stringify([{ instanceId: ENV.INSTANCE_ID }]),
      StartTime: fmt(start || new Date(0)),
      EndTime: fmt(end || new Date()),
      Period: period,
      Length: length,
    },
  });
  return parseData(r);
}

module.exports = { cmsLast, cmsList };
