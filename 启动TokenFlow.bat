@echo off
chcp 65001 >nul
echo 正在启动 TokenFlow Windows 客户端...
if exist "%~dp0release\win-unpacked\TokenFlow.exe" (
  start "" "%~dp0release\win-unpacked\TokenFlow.exe"
) else (
  start "" "%~dp0release\windows-acceptance\win-unpacked\TokenFlow.exe"
)
