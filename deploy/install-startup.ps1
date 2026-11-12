# Registers the "STOP Server" scheduled task, which runs run-server.ps1 (the watchdog that keeps the server running)
# and starts it now. Run it again any time; it replaces the task.
#
#   .\install-startup.ps1           Starts when this Windows user logs on. No admin needed, but after a restart the
#                                   app is down until someone logs on to this PC.
#   .\install-startup.ps1 -AtBoot   Starts when the PC boots, before anyone logs on (runs as SYSTEM). Run it from
#                                   PowerShell opened with "Run as administrator". Recommended for the office server.
param([switch]$AtBoot)

$ErrorActionPreference = 'Stop'
$taskName = 'STOP Server'
$script = Join-Path $PSScriptRoot 'run-server.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
# No time limit; if the watchdog itself ever stops, Task Scheduler starts it again every minute
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 9999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew

if ($AtBoot) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw 'Starting at boot needs admin: open PowerShell with "Run as administrator" and run this again.' }
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Keeps the STOP app (API on 5000, site on 5173) running. See deploy\README.md.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started '$taskName' ($(if ($AtBoot) { 'at boot, as SYSTEM' } else { "at log on of $env:USERNAME" }))."
Write-Host "Log: $(Join-Path (Split-Path -Parent $PSScriptRoot) 'logs\server.log')"
