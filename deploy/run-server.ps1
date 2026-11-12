# Keeps the STOP server running. Starts backend/server.js (the API on 5000 and the built site on 5173) and starts it
# again whenever it stops, whether it crashed or was stopped on purpose to apply an update (see update.ps1).
# The "STOP Server" scheduled task runs this at log on or at boot (see install-startup.ps1).
# Output goes to logs\server.log next to this folder; the log is set aside as server.log.old once it passes 10 MB.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'server.log'

# Only one copy of this script at a time (machine-wide when allowed, else for this Windows session)
try { $mutex = New-Object System.Threading.Mutex($false, 'Global\STOP-Server-Watchdog') }
catch { $mutex = New-Object System.Threading.Mutex($false, 'STOP-Server-Watchdog') }
if (-not $mutex.WaitOne(0)) { exit 0 }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

function Write-Log($text) { Add-Content -Path $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $text" -Encoding UTF8 }

$delay = 5
while ($true) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Path $log -Destination "$log.old" -Force }
    Write-Log "Starting the STOP server ($node)"
    $started = Get-Date
    Set-Location $backend
    cmd.exe /c "`"$node`" server.js >> `"$log`" 2>&1"
    $code = $LASTEXITCODE
    $ran = [int]((Get-Date) - $started).TotalSeconds
    # A server that keeps failing right away (database down, port taken) is retried less and less often, up to every
    # 5 minutes; one that ran for a while is restarted after 5 seconds
    if ($ran -lt 60) { $delay = [Math]::Min($delay * 2, 300) } else { $delay = 5 }
    Write-Log "The STOP server stopped (exit code $code after $ran s). Starting it again in $delay s."
    Start-Sleep -Seconds $delay
}
