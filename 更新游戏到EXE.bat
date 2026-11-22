@echo off
chcp 65001 >nul
echo 正在自动备份并热更新《墨刃·草稿纸决斗》到 EXE 程序...
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\update-exe.ps1"
pause
