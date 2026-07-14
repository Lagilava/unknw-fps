@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Room Breach — Internet Multiplayer

echo.
echo  =====================================================
echo   ROOM BREACH — INTERNET MULTIPLAYER LAUNCHER
echo  =====================================================
echo.

:: ─── 1. Node.js ───────────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo [FAIL] Node.js not found.
    echo        Install from: https://nodejs.org
    echo.
    pause & exit /b 1
)
echo [ OK ] Node.js

:: ─── 2. Dependencies ──────────────────────────────────────────────────────────
if not exist "%~dp0node_modules\peer" (
    echo [ .. ] Installing dependencies ^(one-time^)...
    npm install --prefix "%~dp0" >nul 2>nul
    if not exist "%~dp0node_modules\peer" (
        echo [FAIL] npm install failed. Run it manually in this folder.
        pause & exit /b 1
    )
    echo [ OK ] Dependencies installed
) else (
    echo [ OK ] Dependencies present
)

:: ─── 3. Game + PeerJS server ──────────────────────────────────────────────────
echo [ .. ] Starting game + PeerJS server on 127.0.0.1:8000...
start "RB-SERVER" /min cmd /k node "%~dp0server.js" 8000
timeout /t 3 /nobreak >nul

:: Verify it started
powershell -NoProfile -Command ^
    "try{$t=New-Object Net.Sockets.TcpClient('127.0.0.1',8000);$t.Close()}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
    echo [FAIL] Server did not start on port 8000. Port may be in use.
    echo        Close whatever is using port 8000 and retry.
    pause & exit /b 1
)
echo [ OK ] Server on 127.0.0.1:8000

:: ─── 4. cloudflared ──────────────────────────────────────────────────────────
set "CF=%~dp0cloudflared.exe"
if not exist "%CF%" (
    echo [ .. ] Downloading cloudflared tunnel client ^(~30 MB, one-time^)...
    powershell -NoProfile -Command ^
        "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%' -UseBasicParsing } catch { exit 1 }"
    if not exist "%CF%" (
        echo.
        echo [FAIL] Download failed. Get cloudflared manually:
        echo        https://github.com/cloudflare/cloudflared/releases/latest
        echo        Place cloudflared.exe next to this bat file, then re-run.
        echo.
        pause & exit /b 1
    )
    echo [ OK ] cloudflared downloaded
) else (
    echo [ OK ] cloudflared present
)

:: ─── 5. Cloudflare Quick Tunnel ───────────────────────────────────────────────
set "CF_LOG=%TEMP%\rb_cf_%RANDOM%.log"
set "CF_PS=%TEMP%\rb_cf_monitor_%RANDOM%.ps1"
if exist "%CF_LOG%" del /f /q "%CF_LOG%"

(
echo $cfExe   = '%CF%'
echo $logPath = '%CF_LOG%'
echo $psi = New-Object System.Diagnostics.ProcessStartInfo
echo $psi.FileName               = $cfExe
echo $psi.Arguments              = 'tunnel --url http://127.0.0.1:8000'
echo $psi.RedirectStandardError  = $true
echo $psi.RedirectStandardOutput = $true
echo $psi.UseShellExecute        = $false
echo $psi.CreateNoWindow         = $true
echo $proc = [System.Diagnostics.Process]::Start^($psi^)
echo $proc.Id ^| Out-File ^(Join-Path $env:TEMP 'rb_cf_pid.txt'^) -Encoding ascii
echo while ^(-not $proc.HasExited^) {
echo     $line = $proc.StandardError.ReadLine^(^)
echo     if ^($null -ne $line^) { Add-Content -Path $logPath -Value $line }
echo }
) > "%CF_PS%"

echo [ .. ] Opening Cloudflare tunnel ^(takes ~15 seconds^)...
start "RB-TUNNEL" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%CF_PS%"

:: Poll for tunnel URL — up to 60 seconds
set "TUNNEL_URL="
for /l %%I in (1,1,60) do (
    timeout /t 1 /nobreak >nul
    if exist "%CF_LOG%" (
        for /f "usebackq delims=" %%U in (
            `powershell -NoProfile -Command "$c=try{[IO.File]::ReadAllText('%CF_LOG%')}catch{''}; if($c -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'){$Matches[0]}"`
        ) do set "TUNNEL_URL=%%U"
    )
    if defined TUNNEL_URL goto :tunnel_ready
)

echo.
echo [FAIL] Tunnel URL not detected after 60 seconds.
echo        Check the RB-TUNNEL window for errors.
echo        Log: %CF_LOG%
echo.
pause & exit /b 1

:tunnel_ready

:: ─── 6. Build game URL ────────────────────────────────────────────────────────
::  Extract hostname from tunnel URL (strip "https://")
set "TUNNEL_HOST=!TUNNEL_URL:https://=!"

::  Self-hosted PeerJS path, port 443 (HTTPS), secure=1
::  This makes every client use OUR broker instead of the public one.
set "PEER_PARAMS=?peerhost=!TUNNEL_HOST!&peerport=443&peersecure=1&peerpath=/peerjs"

set "GAME_FILE=first_person_shooter_room_game%%20(1).html"
set "GAME_URL=!TUNNEL_URL!/!GAME_FILE!!PEER_PARAMS!"

echo [ OK ] Tunnel ready: !TUNNEL_URL!
echo.
echo ===================================================================
echo.
echo   INTERNET MULTIPLAYER — SHARE THIS URL WITH ALL PLAYERS:
echo.
echo   !GAME_URL!
echo.
echo   How it works:
echo     * You (host)   — open the URL above, click Multiplayer ^> Host,
echo                      then share the 6-letter room code with friends.
echo     * Friends      — open the SAME URL, click Multiplayer ^> Join,
echo                      enter your room code.
echo     * Works from any internet connection, any network, any country.
echo     * URL changes every time you restart this launcher.
echo     * Keep ALL server windows open for the entire session.
echo     * Signalling is SELF-HOSTED — no public broker dependency.
echo.
echo ===================================================================
echo.

:: ─── 7. Open Chrome ──────────────────────────────────────────────────────────
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "!GAME_URL!"
    echo [ OK ] Chrome opened
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "!GAME_URL!"
    echo [ OK ] Chrome opened
) else (
    start "" "!GAME_URL!"
    echo [ OK ] Browser opened ^(Chrome not found, used default^)
)

echo.
echo   Press any key when done playing to shut down all servers.
pause >nul

:: ─── 8. Cleanup ───────────────────────────────────────────────────────────────
echo.
echo Shutting down servers...

:: Kill cloudflared by saved PID
if exist "%TEMP%\rb_cf_pid.txt" (
    set /p CF_PID= < "%TEMP%\rb_cf_pid.txt"
    if defined CF_PID (
        taskkill /PID !CF_PID! /F >nul 2>nul
    )
)
taskkill /f /im cloudflared.exe >nul 2>nul

:: Kill Node game server by port
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr "127.0.0.1:8000.*LISTENING"') do (
    taskkill /PID %%P /F >nul 2>nul
)

:: Clean up temp files
del /f /q "%CF_PS%" "%CF_LOG%" "%TEMP%\rb_cf_pid.txt" >nul 2>nul

echo Done. Thanks for playing!
timeout /t 2 /nobreak >nul
