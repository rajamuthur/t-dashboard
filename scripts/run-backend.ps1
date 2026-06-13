# Always-on launcher for the FastAPI backend (port 8000, localhost only).
# Restarts automatically if the process exits/crashes. Logs to scripts/logs/backend.log.
$ErrorActionPreference = "Continue"

$root   = Split-Path -Parent $PSScriptRoot          # ...\project-auth
$py     = Join-Path $root ".venv\Scripts\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$log    = Join-Path $logDir "backend.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Set-Location $root

while ($true) {
    "[{0}] starting backend (uvicorn :8000)" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    & $py -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 *>> $log
    "[{0}] backend exited (code $LASTEXITCODE), restarting in 3s" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    Start-Sleep -Seconds 3
}
