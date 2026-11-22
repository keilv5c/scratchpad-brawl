@echo off
chcp 65001 >nul
echo 正在完整重编译《墨刃·草稿纸决斗》桌面外壳 EXE 与最新资源...
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\update-exe.ps1" -RebuildShell
pause
