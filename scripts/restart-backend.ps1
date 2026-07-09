# Run this AFTER changing backend code, so the restarted uvicorn loads it.
# Python needs no build step — this bounces the scheduled task.
#
# IMPORTANT: kill ALL backend instances, not just the port-8000 owner. A prior
# restart could leave a second uvicorn (and its run-backend.ps1 while-loop)
# alive but not bound to the port; that duplicate keeps its own DB connection
# and can hold the SQLite write lock, surfacing as "database is locked" on every
# write (refresh-all, rerun, etc.). We tear down every instance so exactly one
# backend runs.
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "TDashboard Backend" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Backend task not installed - start it however you normally run it." -ForegroundColor Yellow
    return
}

Write-Host "Restarting 'TDashboard Backend' task..." -ForegroundColor Cyan
Stop-ScheduledTask -TaskName "TDashboard Backend"
Start-Sleep -Seconds 2

# 1) Kill every backend uvicorn worker (not just whoever owns port 8000).
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*uvicorn*backend.main*' } |
    ForEach-Object {
        Write-Host "  killing uvicorn $($_.ProcessId)" -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# 2) Kill orphaned run-backend.ps1 while-loops (they respawn uvicorn) — but not this script.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*run-backend.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object {
        Write-Host "  killing orphaned run-backend loop $($_.ProcessId)" -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# 3) Free port 8000 if anything still holds it.
$owner = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($owner) {
    Write-Host "  killing process $owner still on port 8000" -ForegroundColor Yellow
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

Start-ScheduledTask -TaskName "TDashboard Backend"
Start-Sleep -Seconds 2
$n = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*uvicorn*backend.main*' }).Count
Write-Host "Done. Backend restarted (uvicorn instances now running: $n)." -ForegroundColor Green
