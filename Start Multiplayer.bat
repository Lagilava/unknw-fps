@echo off
title Room Breach FPS - Multiplayer Server
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-multiplayer.ps1"
echo.
echo Server stopped. Press any key to close.
pause >nul
