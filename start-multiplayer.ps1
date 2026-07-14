# ============================================================================
#  Room Breach FPS - Multiplayer Launcher
#  Starts the game server + Cloudflare tunnel, auto-restarts either if it dies,
#  and always shows the current public URL to share with friends.
#  Press Ctrl+C (or close this window) to stop everything.
# ============================================================================

$ErrorActionPreference = "SilentlyContinue"
$ProjectDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port        = 8765
$HtmlFile    = "first_person_shooter_room_game%20(1).html"

# Locate cloudflared: known install paths → PATH → local .tools copy.
function Find-Cloudflared {
  $candidates = @(
    "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    "C:\Program Files\cloudflared\cloudflared.exe",
    (Join-Path $ProjectDir ".tools\cloudflared.exe")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $inPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($inPath) { return $inPath.Source }
  return $null
}
$Cloudflared = Find-Cloudflared
if (-not $Cloudflared) {
  Write-Host ""
  Write-Host "  cloudflared is not installed (needed to make the game reachable" -ForegroundColor Yellow
  Write-Host "  from the internet without router port-forwarding)." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Install it with:  winget install Cloudflare.cloudflared" -ForegroundColor Cyan
  Write-Host "  ...then run this launcher again." -ForegroundColor Cyan
  Read-Host  "  Press Enter to exit"
  exit 1
}

$ServerOut = Join-Path $env:TEMP "rb_server_out.log"
$ServerErr = Join-Path $env:TEMP "rb_server_err.log"
$TunnelOut = Join-Path $env:TEMP "rb_tunnel_out.log"
$TunnelErr = Join-Path $env:TEMP "rb_tunnel_err.log"

$script:ServerProc = $null
$script:TunnelProc = $null
$script:TunnelUrl  = $null
$script:TurnQuery  = ""     # &turnhost=...&turnuser=...&turncred=... if configured
$script:TurnActive = $false

# Load optional TURN relay credentials from turn-config.txt (next to this script).
# Format (one per line):  turnhost=...  turnuser=...  turncred=...
# Without it the game uses STUN only (fine for most home networks). With it,
# friends on mobile/CGNAT/strict-NAT can also connect.
function Load-TurnConfig {
  $cfg = Join-Path $ProjectDir "turn-config.txt"
  if (-not (Test-Path $cfg)) { return }
  $h = $null; $u = $null; $c = $null
  foreach ($line in Get-Content $cfg) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    if ($t -match '^\s*turnhost\s*=\s*(.+)$') { $h = $Matches[1].Trim() }
    elseif ($t -match '^\s*turnuser\s*=\s*(.+)$') { $u = $Matches[1].Trim() }
    elseif ($t -match '^\s*turncred\s*=\s*(.+)$') { $c = $Matches[1].Trim() }
  }
  if ($h -and $u -and $c) {
    Add-Type -AssemblyName System.Web
    $eh = [System.Web.HttpUtility]::UrlEncode($h)
    $eu = [System.Web.HttpUtility]::UrlEncode($u)
    $ec = [System.Web.HttpUtility]::UrlEncode($c)
    $script:TurnQuery  = "&turnhost=$eh&turnuser=$eu&turncred=$ec"
    $script:TurnActive = $true
  }
}

function Get-GameUrl($url) {
  return "https://$url/$HtmlFile" + "?peerhost=$url&peerport=443&peersecure=1&peerpath=/peerjs" + $script:TurnQuery
}

# Open the game in Chrome if available, otherwise the default browser.
function Open-GameTab($gameUrl) {
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $gameUrl }
  else { Start-Process $gameUrl }
}

function Write-Banner($url) {
  Clear-Host
  $game = Get-GameUrl $url
  Write-Host ""
  Write-Host "  ===============================================================" -ForegroundColor DarkCyan
  Write-Host "              UNKNW - INTERNET MULTIPLAYER ONLINE" -ForegroundColor Cyan
  Write-Host "  ===============================================================" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "  Share this link with everyone (you AND your friends):" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  $game" -ForegroundColor Green
  Write-Host ""
  Write-Host "  ---------------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host "  Host clicks HOST GAME, then shares the 6-char code." -ForegroundColor Gray
  Write-Host "  Friends click JOIN GAME, then enter that code." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  FIRST LOAD IS BIG (~150 MB of game assets through the tunnel)." -ForegroundColor Yellow
  Write-Host "  Tell friends the loading screen can take several minutes the" -ForegroundColor Yellow
  Write-Host "  first time - it is downloading, not frozen. Later loads are fast." -ForegroundColor Yellow
  Write-Host ""
  if ($script:TurnActive) {
    Write-Host "  TURN relay: ACTIVE (works on mobile / strict NAT too)." -ForegroundColor Green
  } else {
    Write-Host "  TURN relay: off (STUN only). If a friend sees 'could not" -ForegroundColor DarkYellow
    Write-Host "  establish a connection', set up turn-config.txt (2 minutes," -ForegroundColor DarkYellow
    Write-Host "  free) - copy turn-config.example.txt and follow the steps." -ForegroundColor DarkYellow
  }
  Write-Host ""
  Write-Host "  This window must stay open. Press Ctrl+C to stop the server." -ForegroundColor DarkGray
  Write-Host "  Server + tunnel auto-restart if they crash." -ForegroundColor DarkGray
  Write-Host ""
  try { Set-Clipboard -Value $game; Write-Host "  (Link copied to clipboard.)" -ForegroundColor DarkGray } catch {}
  Write-Host ""
}

function Free-Port($p) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
}

# Dependency-free port check. Avoids Invoke-WebRequest, which can hang in a
# hidden -NoProfile PowerShell 5.1 session (IE proxy auto-detect stall).
function Test-PortListening($p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok  = $iar.AsyncWaitHandle.WaitOne(800)
    if ($ok -and $client.Connected) { $client.EndConnect($iar); return $true }
    return $false
  } catch { return $false }
  finally { $client.Close() }
}

function Start-GameServer {
  Free-Port $Port
  Start-Sleep -Milliseconds 400
  Remove-Item $ServerOut, $ServerErr -ErrorAction SilentlyContinue
  $script:ServerProc = Start-Process -FilePath "node" `
    -ArgumentList "server.js", "$Port" `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr `
    -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-PortListening $Port) { return $true }
  }
  return $false
}

function Start-Tunnel {
  Remove-Item $TunnelOut, $TunnelErr -ErrorAction SilentlyContinue
  $script:TunnelProc = Start-Process -FilePath $Cloudflared `
    -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--no-autoupdate" `
    -RedirectStandardOutput $TunnelOut -RedirectStandardError $TunnelErr `
    -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 500
    $log = (Get-Content $TunnelErr -ErrorAction SilentlyContinue) + (Get-Content $TunnelOut -ErrorAction SilentlyContinue)
    $m = $log | Select-String -Pattern 'https://([a-z0-9-]+\.trycloudflare\.com)' | Select-Object -First 1
    if ($m) {
      $script:TunnelUrl = $m.Matches[0].Groups[1].Value
      return $true
    }
  }
  return $false
}

function Stop-All {
  Write-Host ""
  Write-Host "  Shutting down..." -ForegroundColor Yellow
  if ($script:TunnelProc -and -not $script:TunnelProc.HasExited) { Stop-Process -Id $script:TunnelProc.Id -Force -ErrorAction SilentlyContinue }
  if ($script:ServerProc -and -not $script:ServerProc.HasExited) { Stop-Process -Id $script:ServerProc.Id -Force -ErrorAction SilentlyContinue }
  Free-Port $Port
  Write-Host "  Stopped. You can close this window." -ForegroundColor Gray
}

$null = Register-EngineEvent -SourceIdentifier ([System.Management.Automation.PsEngineEvent]::Exiting) -Action { Stop-All }

try {
  Load-TurnConfig
  Write-Host ""
  Write-Host "  Starting Room Breach server..." -ForegroundColor Cyan
  if (-not (Start-GameServer)) {
    Write-Host "  ERROR: server failed to start. Check $ServerErr" -ForegroundColor Red
    Get-Content $ServerErr -Tail 15 -ErrorAction SilentlyContinue
    Read-Host "  Press Enter to exit"
    exit 1
  }
  Write-Host "  Server up. Opening Cloudflare tunnel..." -ForegroundColor Cyan
  if (-not (Start-Tunnel)) {
    Write-Host "  ERROR: tunnel failed to start. Check $TunnelErr" -ForegroundColor Red
    Get-Content $TunnelErr -Tail 15 -ErrorAction SilentlyContinue
    Read-Host "  Press Enter to exit"
    exit 1
  }
  Write-Banner $script:TunnelUrl
  # Open the host's own game tab through the public URL (same link the friends use).
  Open-GameTab (Get-GameUrl $script:TunnelUrl)

  while ($true) {
    Start-Sleep -Seconds 3

    $serverDead = (-not $script:ServerProc) -or $script:ServerProc.HasExited
    if ($serverDead) {
      Write-Host "  [watchdog] Server stopped - restarting..." -ForegroundColor Yellow
      if (Start-GameServer) { Write-Host "  [watchdog] Server back up." -ForegroundColor Green }
      else { Write-Host "  [watchdog] Server restart failed, retrying..." -ForegroundColor Red }
    }

    $tunnelDead = (-not $script:TunnelProc) -or $script:TunnelProc.HasExited
    if ($tunnelDead) {
      Write-Host "  [watchdog] Tunnel stopped - restarting (URL will change)..." -ForegroundColor Yellow
      $old = $script:TunnelUrl
      if (Start-Tunnel) {
        if ($script:TunnelUrl -ne $old) { Write-Banner $script:TunnelUrl }
        else { Write-Host "  [watchdog] Tunnel back up." -ForegroundColor Green }
      } else {
        Write-Host "  [watchdog] Tunnel restart failed, retrying..." -ForegroundColor Red
      }
    }
  }
}
finally {
  Stop-All
}
