# Run this AFTER changing backend code, so the restarted uvicorn loads it.
# Python needs no build step — this just bounces the scheduled task, killing any
# orphaned uvicorn still holding port 8000 (same issue as rebuild-frontend.ps1:
# stopping the task kills the wrapper but can leave the child process bound to
# the port, so the relaunched process fails to bind and old code keeps serving).
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "TDashboard Backend" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Backend task not installed - start it however you normally run it." -ForegroundColor Yellow
    return
}

Write-Host "Restarting 'TDashboard Backend' task..." -ForegroundColor Cyan
Stop-ScheduledTask -TaskName "TDashboard Backend"
Start-Sleep -Seconds 2
$owner = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($owner) {
    Write-Host "Killing orphaned process $owner still on port 8000..." -ForegroundColor Yellow
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
Start-ScheduledTask -TaskName "TDashboard Backend"
Write-Host "Done. Backend restarted with the latest code." -ForegroundColor Green
