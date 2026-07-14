@echo off
title UNKNW - Internet Multiplayer
rem ============================================================================
rem  UNKNW - Internet Multiplayer launcher
rem
rem  Starts the game server + a free Cloudflare tunnel so friends ANYWHERE can
rem  play - no router setup, no port forwarding. Then opens the game in Chrome.
rem
rem  Requirements (one-time):
rem    1. Node.js installed (node in PATH), then "npm install" in this folder.
rem    2. cloudflared installed:  winget install Cloudflare.cloudflared
rem    3. Optional but recommended: TURN relay credentials for friends on
rem       mobile data / strict networks - copy turn-config.example.txt to
rem       turn-config.txt and follow the instructions inside (free, 2 min).
rem
rem  The console window shows the link to send your friends. Keep it open
rem  while playing.
rem ============================================================================
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-multiplayer.ps1"
echo.
echo Server stopped. Press any key to close.
pause >nul
