@echo off
chcp 65001 >nul
echo 正在启动 TokenFlow Windows 客户端...
start "" "%~dp0release\windows-acceptance\win-unpacked\TokenFlow.exe"
