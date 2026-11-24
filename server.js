'use strict';
/**
 * server.js —— 本地"后端"（跑在你自己电脑上）
 * 1) 先读 config.json → process.env（必须在 require router/modules 之前，
 *    因为 modules/config.js 在被 require 时就会算好 ENV）
 * 2) 起 127.0.0.1 的本地 HTTP 服务：GET / → 前端页面；GET /?action=… → 调 阿里云/CF/飞书/RCON/MC/中继。
 * 直接跑： node server.js  （http://127.0.0.1:8790）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// ① 读配置：config.json → process.env
(function loadConfig() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) { console.warn('⚠ 未找到 config.json（请复制 config.example.json 为 config.json 并填值）'); return; }
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    let n = 0;
    for (const k of Object.keys(cfg)) if (cfg[k] !== undefined && cfg[k] !== '') { process.env[k] = String(cfg[k]); n++; }
    console.log('✓ 已加载 config.json（' + n + ' 个非空值）');
  } catch (e) { console.warn('⚠ config.json 解析失败：' + e.message); }
})();

// ② 再加载路由/模块（此时 ENV 已读到值）
const { handle } = require('./router');

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const query = Object.fromEntries(u.searchParams);
      if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
      if (!query.action) {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      const out = await handle(query, req.method);
      res.writeHead(out.status, Object.assign({ 'Content-Type': out.contentType || 'application/json' }, cors()));
      res.end(out.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, msg: '服务器错误：' + (e && e.message ? e.message : String(e)) }));
    }
  });
}

function start() {
  const port = parseInt(process.env.LOCAL_PORT || '8790', 10);
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log('✓ 控制台已启动：http://127.0.0.1:' + port);
    console.log('  办法二：在 config.json 填 RELAY_URL（阿里云 FC 触发器地址）+ RELAY_SECRET，界面切"走函数"。');
  });
  return server;
}

module.exports = { start, createServer };
if (require.main === module) start();
