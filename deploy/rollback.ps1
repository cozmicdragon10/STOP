# Goes back to the previous build of the site (or a named one) and restarts the server. Use it when an update turns
# out to have a problem on screen. It changes only the screens; database changes made by an update stay.
#
#   .\rollback.ps1                    Back to the build before the current one
#   .\rollback.ps1 -To 20261112-1630  A specific build (a folder name in site\builds)
#   .\rollback.ps1 -List              Show the builds that are kept
param([string]$To, [switch]$List)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$builds = Join-Path $root 'site\builds'
$current = Join-Path $root 'site\current.txt'
$now = if (Test-Path $current) { (Get-Content $current -Raw).Trim() } else { '' }
$all = @(Get-ChildItem $builds -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'index.html') } |
    Sort-Object Name -Descending | Select-Object -ExpandProperty Name)

if ($List) {
    $all | ForEach-Object { if ($_ -eq $now) { "$_  (live)" } else { $_ } }
    exit 0
}
if (-not $To) {
    $older = @($all | Where-Object { $_ -lt $now })
    if (-not $older) { throw "There is no build older than the live one ($now). See .\rollback.ps1 -List." }
    $To = $older[0]
}
if ($all -notcontains $To) { throw "No build named '$To'. See .\rollback.ps1 -List." }

Set-Content -Path $current -Value $To -Encoding ASCII
Write-Host "Switching the site from $now to $To."
& (Join-Path $PSScriptRoot 'restart.ps1')
