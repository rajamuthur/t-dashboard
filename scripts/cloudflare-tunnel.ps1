# Always-on Cloudflare QUICK tunnel for the frontend (:3000). Free, no domain.
# Prints a random https://<id>.trycloudflare.com URL that CHANGES on every
# restart (reboot/crash). Only :3000 is exposed; the backend stays on localhost.
#
# Find the current public URL any time:
#   Select-String trycloudflare scripts\logs\cloudflare.log | Select-Object -Last 1
$ErrorActionPreference = "Continue"
$bin    = Join-Path $PSScriptRoot "bin"
$exe    = Join-Path $bin "cloudflared.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$log    = Join-Path $logDir "cloudflare.log"
New-Item -ItemType Directory -Force -Path $bin, $logDir | Out-Null

# Self-contained: download cloudflared on first run (winget not required).
if (-not (Test-Path $exe)) {
    "[{0}] downloading cloudflared..." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    try {
        Invoke-WebRequest -UseBasicParsing `
            -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
            -OutFile $exe
    } catch {
        "[{0}] download failed: $($_.Exception.Message)" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
        throw
    }
}

while ($true) {
    "[{0}] starting quick tunnel -> http://localhost:3000" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    & $exe tunnel --url http://localhost:3000 --no-autoupdate --logfile $log
    "[{0}] tunnel exited (code $LASTEXITCODE), restarting in 5s" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
    Start-Sleep -Seconds 5
}
