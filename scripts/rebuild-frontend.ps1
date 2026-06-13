# Run this AFTER changing frontend code, so `next start` serves the new build.
# It rebuilds, then restarts the frontend scheduled task (if installed).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$fe   = Join-Path $root "frontend"
$npm  = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = "C:\nvm4w\nodejs\npm.cmd" }

Set-Location $fe
Write-Host "Building production frontend..." -ForegroundColor Cyan
& $npm run build

# Bounce the scheduled task so `next start` picks up the new .next output.
$task = Get-ScheduledTask -TaskName "TDashboard Frontend" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Restarting 'TDashboard Frontend' task..." -ForegroundColor Cyan
    Stop-ScheduledTask  -TaskName "TDashboard Frontend"
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName "TDashboard Frontend"
    Write-Host "Done. New build is live." -ForegroundColor Green
} else {
    Write-Host "Build done. (Frontend task not installed - start it however you normally run it.)" -ForegroundColor Yellow
}
