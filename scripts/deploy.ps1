#!/usr/bin/env pwsh
# Workstation deploy helper (PowerShell). CI handles main-branch
# deploys; this is for one-offs. Firmware needs the board on USB.
#
# Usage:
#   ./scripts/deploy.ps1 -Backend
#   ./scripts/deploy.ps1 -Webapp
#   ./scripts/deploy.ps1 -Firmware
#   ./scripts/deploy.ps1 -All        # backend + webapp (not firmware)
[CmdletBinding()]
param(
    [switch]$Backend,
    [switch]$Webapp,
    [switch]$Firmware,
    [switch]$All
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Step([string]$Label, [scriptblock]$Command) {
    # Reset first: a stale non-zero code from an earlier native call must not fail a step whose last statement is not native.
    $global:LASTEXITCODE = 0
    # $ErrorActionPreference = 'Stop' does not cover native executables:
    # a failed pnpm/pio call would otherwise fall through to the next step.
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
}

if ($All) { $Backend = $true; $Webapp = $true }
if (-not ($Backend -or $Webapp -or $Firmware)) {
    Write-Error 'Pick at least one: -Backend, -Webapp, -Firmware, or -All'
}

if ($Backend) {
    Write-Host '-- backend --' -ForegroundColor Cyan
    Invoke-Step 'db:migrate:remote' { pnpm --filter feedme2-backend db:migrate:remote }
    Invoke-Step 'backend deploy' { pnpm --filter feedme2-backend deploy }
}
if ($Webapp) {
    Write-Host '-- webapp --' -ForegroundColor Cyan
    Invoke-Step 'webapp build' { pnpm --filter feedme2-webapp build }
    Invoke-Step 'webapp deploy' { pnpm --filter feedme2-webapp deploy }
}
if ($Firmware) {
    Write-Host '-- firmware (USB) --' -ForegroundColor Cyan
    Push-Location firmware
    try { Invoke-Step 'firmware upload' { pio run -e crowpanel -t upload } } finally { Pop-Location }
}
