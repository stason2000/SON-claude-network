@echo off
chcp 65001 >nul
powershell -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
