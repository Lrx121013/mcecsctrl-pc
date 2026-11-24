@echo off
chcp 65001 >nul
title ECS 控制台（安装+运行）
echo [1/2] 安装依赖（首次需联网，约1-3分钟，需已装 Node.js）...
call npm install
if errorlevel 1 ( echo 安装失败：请确认已安装 Node.js 并重启终端 & pause & exit /b )
echo.
echo [2/2] 启动桌面软件...
call npm start
pause
