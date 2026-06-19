# Daily Fyers auto-login (TOTP). Fyers disabled the refresh-token API (SEBI), so
# a fresh access token must be minted by logging in each day. Schedule this to run
# every trading morning ~8:15 AM; it writes the new token to .env, which the
# backend re-reads automatically (no restart needed).
#
# Requires in .env: CLIENT_APP_ID, APP_SECRET, REDIRECT_URI, FYERS_ID,
# FYERS_TOTP_SECRET, FYERS_PIN.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$py   = Join-Path $root ".venv\Scripts\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$log  = Join-Path $logDir "fyers-login.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Set-Location $root
"[{0}] running Fyers auto-login..." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss") | Out-File -Append -Encoding utf8 $log
& $py -c "from dotenv import load_dotenv; load_dotenv(); from backend.fyers_auth import auto_login; import json; print(json.dumps(auto_login()))" *>> $log
