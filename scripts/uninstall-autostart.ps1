# Removes the auto-start tasks. RUN AS ADMINISTRATOR.
$ErrorActionPreference = "Continue"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this in an elevated (Administrator) PowerShell." -ForegroundColor Red
    exit 1
}

foreach ($name in @("TDashboard Backend", "TDashboard Frontend")) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "removed: $name" -ForegroundColor Yellow
    } else {
        Write-Host "not found: $name"
    }
}
Write-Host "Done. (This does not touch the cloudflared service - remove that with 'cloudflared service uninstall'.)"
