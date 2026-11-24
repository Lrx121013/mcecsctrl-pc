'use strict';
/**
 * main.js —— Electron 桌面壳
 * 启动本地服务（读 config.json → env）+ 开一个窗口指向 http://127.0.0.1:8790。
 * 运行： npm start（即 electron .）
 */
const { app, BrowserWindow, shell } = require('electron');
const { start } = require('./server');

let win;

function createWindow() {
  const port = process.env.LOCAL_PORT || 8790;
  win = new BrowserWindow({
    width: 960,
    height: 780,
    title: 'ECS 控制台',
    backgroundColor: '#05060a',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL('http://127.0.0.1:' + port);
  // 外链用系统浏览器打开，不在窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  start(); // 起本地服务（含 config.json → env）
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
