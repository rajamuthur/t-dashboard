# Registers the Cloudflare quick tunnel as an at-logon, auto-restarting task,
# so a public URL is available whenever you're logged in. Run once.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "cloudflare-tunnel.ps1"
$user   = "$env:USERDOMAIN\$env:USERNAME"

$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger   = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "TDashboard Cloudflare" -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Cloudflare quick tunnel for the frontend (:3000)" -Force | Out-Null

Write-Host "Registered 'TDashboard Cloudflare' (at logon, auto-restart)." -ForegroundColor Green
Write-Host "Current public URL: Select-String trycloudflare scripts\logs\cloudflare.log | Select-Object -Last 1" -ForegroundColor Yellow
