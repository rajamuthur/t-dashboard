# Registers two Windows Scheduled Tasks that start the backend + frontend when
# you LOG ON, and keep them running (auto-restart on crash).
#
# Why At-Logon (not at-boot/S4U): S4U "run whether logged on or not" tasks are
# unreliable to launch on Windows (they silently report HAS_NOT_RUN). An
# Interactive At-Logon task runs reliably in your session and needs no stored
# password. For a self-hosted box you log into, this covers "always on".
# (For true before-login start, see the note at the bottom of SELF-HOST.md.)
#
# RUN AS ADMINISTRATOR:
#   Right-click PowerShell -> "Run as administrator", then:
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#
# Each launcher already self-restarts on crash; Task Scheduler is the second
# safety net (restarts the whole launcher if it dies).
$ErrorActionPreference = "Stop"

# --- must be elevated ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this in an elevated (Administrator) PowerShell." -ForegroundColor Red
    exit 1
}

$scripts  = $PSScriptRoot
$backend  = Join-Path $scripts "run-backend.ps1"
$frontend = Join-Path $scripts "run-frontend.ps1"
$user     = "$env:USERDOMAIN\$env:USERNAME"

function Register-AppTask {
    param([string]$Name, [string]$Script)

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`""

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user

    # Interactive = runs in your logged-on session, no stored password, reliable.
    # Limited run level: the app needs no elevation (plain localhost servers).
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
        -MultipleInstances IgnoreNew

    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings | Out-Null
    Write-Host "  registered: $Name" -ForegroundColor Green
}

Write-Host "Registering auto-start tasks for $user ..." -ForegroundColor Cyan
Register-AppTask -Name "TDashboard Backend"  -Script $backend
Register-AppTask -Name "TDashboard Frontend" -Script $frontend

Write-Host ""
Write-Host "Starting them now (so you don't have to reboot)..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName "TDashboard Backend"
Start-ScheduledTask -TaskName "TDashboard Frontend"

Write-Host ""
Write-Host "Done. Both auto-start when you log on, and auto-restart on crash." -ForegroundColor Green
Write-Host "Logs: $(Join-Path $scripts 'logs')"
Write-Host "Backend  : http://localhost:8000   Frontend: http://localhost:3000"
Write-Host "Manage in 'Task Scheduler' under the names 'TDashboard Backend' / 'TDashboard Frontend'."
