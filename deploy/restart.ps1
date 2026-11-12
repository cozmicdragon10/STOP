# Restarts the STOP server and waits for the API (5000) and the site (5173) to come back. The watchdog
# (run-server.ps1) starts the server again within seconds of it stopping; on start it serves the build named in
# site\current.txt. Used by update.ps1 and rollback.ps1. When the server runs as SYSTEM (-AtBoot), run as administrator.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverPid = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
if ($serverPid) {
    try { Stop-Process -Id $serverPid -Force -ErrorAction Stop }
    catch { throw "Could not stop the server (pid $serverPid): $($_.Exception.Message). If it runs as SYSTEM, run this as administrator." }
} else {
    Write-Host 'The server was not running; the watchdog will start it.'
}
$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Seconds 2
    $api = [bool](Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue)
    $site = [bool](Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
} until (($api -and $site) -or (Get-Date) -gt $deadline)
if (-not ($api -and $site)) {
    throw "The server did not come back within 90 seconds (API: $api, site: $site). See $(Join-Path $root 'logs\server.log')."
}
Write-Host "`nRestarted. The API (5000) and the site (5173) are running." -ForegroundColor Green
