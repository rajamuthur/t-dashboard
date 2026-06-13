# Always-on launcher for the Next.js frontend in PRODUCTION mode (port 3000).
# Runs `next start` (needs a build). Builds once if .next is missing.
# Restarts automatically if the process exits/crashes. Logs to scripts/logs/frontend.log.
$ErrorActionPreference = "Continue"

$root   = Split-Path -Parent $PSScriptRoot          # ...\project-auth
$fe     = Join-Path $root "frontend"
$logDir = Join-Path $PSScriptRoot "logs"
$log    = Join-Path $logDir "frontend.log"

# Resolve npm.cmd: prefer PATH, fall back to the known nvm4w location.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = "C:\nvm4w\nodejs\npm.cmd" }

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Set-Location $fe

# First boot after a fresh checkout / cleaned build: produce a production build.
if (-not (Test-Path (Join-Path $fe ".next"))) {
    "[{0}] no .next found, running production build" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    & $npm run build *>> $log
}

while ($true) {
    "[{0}] starting frontend (next start :3000)" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    & $npm run start *>> $log
    "[{0}] frontend exited (code $LASTEXITCODE), restarting in 3s" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    Start-Sleep -Seconds 3
}
