@echo off
cd /d "%~dp0"
set "PY_CMD=python"
where python >nul 2>nul || set "PY_CMD=py -3"

if not exist "first_person_shooter_room_game (1).html" (
	call "%~dp0run_room_breach_http_fallback.cmd"
	exit /b %errorlevel%
)

start "Room Breach HTTP Server" /D "%~dp0" cmd /k %PY_CMD% -m http.server 8000 --bind 127.0.0.1

set "SERVER_READY=0"
for /l %%I in (1,1,30) do (
	powershell -NoProfile -Command "try { $client = New-Object System.Net.Sockets.TcpClient('127.0.0.1',8000); $client.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
	if not errorlevel 1 (
		set "SERVER_READY=1"
		goto :server_ready
	)
	timeout /t 1 /nobreak >nul
)

echo.
echo Failed to start the local web server on 127.0.0.1:8000.
echo Keep the server window open and try again.
exit /b 1

:server_ready
set "GAME_URL=http://127.0.0.1:8000/first_person_shooter_room_game%%20(1).html"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
	start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%GAME_URL%"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
	start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%GAME_URL%"
) else (
	start "" "%GAME_URL%"
)