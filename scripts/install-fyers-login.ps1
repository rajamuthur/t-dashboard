# Registers a Windows Scheduled Task that runs the Fyers daily auto-login every
# trading morning at 8:15 AM (mints a fresh access token before market open).
# Run once. Re-run to update.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "fyers-daily-login.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
# 8:15 AM Mon-Fri (NSE trading days; holidays just no-op).
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:15AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "TDashboard Fyers Login" -Action $action -Trigger $trigger `
    -Settings $settings -Description "Daily Fyers TOTP auto-login (fresh access token)" -Force | Out-Null
Write-Host "Registered 'TDashboard Fyers Login' (daily 8:15 AM, Mon-Fri)." -ForegroundColor Green
Write-Host "Make sure .env has FYERS_ID and FYERS_TOTP_SECRET set." -ForegroundColor Yellow
