# Run this ONCE, as Administrator, to stop the dashboard from dying when your
# Windows session locks / disconnects / logs off.
#
# Why: the "TDashboard Backend" / "TDashboard Frontend" scheduled tasks were
# created with LogonType = Interactive, so Windows only runs them while you're
# logged on interactively and STOPS them the moment the session ends (that shows
# up as the backend being down and "unable to login"). Switching to S4U makes
# them run whether you're logged on or not. S4U needs no stored password and
# keeps local + outbound network (Fyers / Telegram) working — it only loses
# access to mapped network drives, which this app doesn't use.
#
# Usage: right-click PowerShell -> "Run as administrator", then:
#   powershell -ExecutionPolicy Bypass -File scripts\make-services-persistent.ps1
$ErrorActionPreference = "Continue"

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
foreach ($name in @("TDashboard Backend", "TDashboard Frontend")) {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $t) { Write-Host "skip: '$name' not installed" -ForegroundColor Yellow; continue }
    try {
        Set-ScheduledTask -TaskName $name -Principal $principal | Out-Null
        Write-Host "OK: '$name' now runs in the background (survives lock/logoff)." -ForegroundColor Green
        Start-ScheduledTask -TaskName $name
    } catch {
        Write-Host "FAILED '$name': $($_.Exception.Message)  (are you running as Administrator?)" -ForegroundColor Red
    }
}
Write-Host "Done." -ForegroundColor Cyan
