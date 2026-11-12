# Puts code changes live: runs the tests, builds the site, and restarts the server (the watchdog starts it again in a
# few seconds; anyone using the app sees a brief "cannot reach the server" and their next action works).
# Nothing changes for staff until this runs, so a half-finished edit never reaches them.
#
#   .\update.ps1              Tests, build, restart
#   .\update.ps1 -SkipTests   Build and restart only
#
# When the server was installed with -AtBoot it runs as SYSTEM: run this from PowerShell opened as administrator.
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Run($dir, $command) {
    Push-Location $dir
    # Warnings a tool prints on stderr (like Vite's chunk size note) aren't failures; the exit code decides
    $ErrorActionPreference = 'Continue'
    try {
        cmd.exe /c "$command 2>&1"
        if ($LASTEXITCODE -ne 0) { throw "'$command' failed in $dir (exit code $LASTEXITCODE). Nothing was changed on the live site." }
    } finally { Pop-Location }
}

if (-not $SkipTests) {
    Step 'Backend tests'
    Run (Join-Path $root 'backend') 'npm test'
    Step 'Frontend tests'
    Run (Join-Path $root 'frontend') 'npx vitest run'
}

Step 'Building the site'
# Each build goes into its own new folder in site\builds; the live one is never renamed or overwritten. Only once the
# build is complete does site\current.txt point at it (see backend\frontendServer.js).
$frontend = Join-Path $root 'frontend'
$builds = Join-Path $root 'site\builds'
$name = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $builds $name
New-Item -ItemType Directory -Force -Path $builds | Out-Null
Run $frontend 'npx tsc -b'
Run $frontend "npx vite build --outDir `"$out`" --emptyOutDir"
if (-not (Test-Path (Join-Path $out 'index.html'))) { throw "The build in $out has no index.html. Nothing was changed on the live site." }
$current = Join-Path $root 'site\current.txt'
$previous = if (Test-Path $current) { (Get-Content $current -Raw).Trim() } else { '' }
Set-Content -Path $current -Value $name -Encoding ASCII
Write-Host "Built $name (was: $(if ($previous) { $previous } else { 'none' }))."
# Keep the newest 5 builds for rollback.ps1; a folder that can't be removed right now is left for next time
Get-ChildItem $builds -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

Step 'Restarting the server'
& (Join-Path $PSScriptRoot 'restart.ps1')
