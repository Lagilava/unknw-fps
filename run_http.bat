@echo off
cd /d "%~dp0"
set "PY_CMD=python"
where python >nul 2>nul || set "PY_CMD=py -3"

if not exist "first_person_shooter_room_game (1).html" (
	echo ERROR: Game file not found.
	pause
	exit /b 1
)

:: Open firewall ports so LAN players can reach the game and signalling server
netsh advfirewall firewall delete rule name="RoomBreachHTTP" >nul 2>nul
netsh advfirewall firewall delete rule name="RoomBreachPeer" >nul 2>nul
netsh advfirewall firewall add rule name="RoomBreachHTTP" protocol=TCP dir=in localport=8000 action=allow >nul 2>nul
netsh advfirewall firewall add rule name="RoomBreachPeer" protocol=TCP dir=in localport=9000 action=allow >nul 2>nul

:: Get LAN IP
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
	set "LAN_IP=%%A"
	goto :got_ip
)
set "LAN_IP=127.0.0.1"
:got_ip
set "LAN_IP=%LAN_IP: =%"

:: Start local PeerJS signalling server if npx is available
where npx >nul 2>nul
if not errorlevel 1 (
	start "Room Breach PeerJS" /D "%~dp0" cmd /k npx --yes peer --port 9000 --allow_discovery
	timeout /t 2 /nobreak >nul
)

:: Start HTTP server on all interfaces so LAN players can connect
start "Room Breach HTTP Server" /D "%~dp0" cmd /k %PY_CMD% -m http.server 8000 --bind 0.0.0.0

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
echo Failed to start the local web server on port 8000.
echo Keep the server window open and try again.
exit /b 1

:server_ready
where npx >nul 2>nul
if not errorlevel 1 (
	set "PEER_PARAMS=?peerhost=%LAN_IP%&peerport=9000"
) else (
	set "PEER_PARAMS="
)

:: URL for LAN peers — uses LAN IP so other machines can reach the HTTP server
set "LAN_URL=http://%LAN_IP%:8000/first_person_shooter_room_game%%20(1).html%PEER_PARAMS%"

:: URL for the HOST machine — uses localhost so the browser gets a secure context
:: (navigator.deviceMemory is only exposed on secure contexts; localhost qualifies).
:: The peerhost param still points to the LAN IP so signalling reaches the local peer server.
set "HOST_URL=http://localhost:8000/first_person_shooter_room_game%%20(1).html%PEER_PARAMS%"

echo.
echo =====================================================
echo  Share this URL with LAN PEERS (other machines):
echo  %LAN_URL%
echo =====================================================
echo.
echo Keep both server windows open while playing.
echo NOTE: Run this .bat as Administrator if peers still
echo       can't connect (needed for firewall rules).
echo.

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
	start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%HOST_URL%"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
	start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%HOST_URL%"
) else (
	start "" "%HOST_URL%"
)
