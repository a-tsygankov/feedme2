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

if ($All) { $Backend = $true; $Webapp = $true }
if (-not ($Backend -or $Webapp -or $Firmware)) {
    Write-Error 'Pick at least one: -Backend, -Webapp, -Firmware, or -All'
}

if ($Backend) {
    Write-Host '-- backend --' -ForegroundColor Cyan
    pnpm --filter feedme2-backend db:migrate:remote
    pnpm --filter feedme2-backend deploy
}
if ($Webapp) {
    Write-Host '-- webapp --' -ForegroundColor Cyan
    pnpm --filter feedme2-webapp build
    pnpm --filter feedme2-webapp deploy
}
if ($Firmware) {
    Write-Host '-- firmware (USB) --' -ForegroundColor Cyan
    Push-Location firmware
    try { pio run -e crowpanel -t upload } finally { Pop-Location }
}
