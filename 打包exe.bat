@echo off
chcp 65001 >nul
title ECS 控制台（打包 Windows 单文件 exe）
echo 安装依赖...
call npm install
echo 打包 .exe（首次较慢，会下载 Electron）...
call npm run build:win
echo.
echo 完成！可运行的单文件 exe 在 dist\ 目录（找 *.exe）
pause
