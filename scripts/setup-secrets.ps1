#!/usr/bin/env pwsh
<#
.SYNOPSIS
  One-stop secrets bootstrap for feedme2: GitHub Actions secrets (via
  `gh`) + Cloudflare Worker secrets (via `wrangler`), plus one-time
  D1/R2 provisioning. Full secret matrix:
  docs/superpowers/specs/2026-09-20-feedme2-design.md Sec. 6.4.

.DESCRIPTION
  1. COPY this file to scripts/setup-secrets.local.ps1 (gitignored).
  2. Fill in the placeholder values in the FILL ME IN block below.
     - Leave 'GENERATE' where present to have the script mint a
       cryptographically random 32-byte base64 key (AUTH_SECRET).
     - Anything still wrapped in <angle-brackets> is skipped with a
       warning - optional secrets can stay as placeholders forever.
  3. Run it:
       ./scripts/setup-secrets.local.ps1 -Provision   # once: create D1 + R2
       ./scripts/setup-secrets.local.ps1 -All         # GitHub + Worker secrets
       ./scripts/setup-secrets.local.ps1 -GitHub      # only gh secret set
       ./scripts/setup-secrets.local.ps1 -Cloudflare  # only wrangler secret put
       ./scripts/setup-secrets.local.ps1 -All -DryRun # show plan, set nothing
  4. NEVER commit a filled-in copy. Values are never echoed.

  Prereqs: `gh auth login` done (for -GitHub); `wrangler login` or
  CLOUDFLARE_API_TOKEN in the environment (for -Cloudflare/-Provision);
  `pnpm install` done (wrangler runs via `pnpm exec` from backend/).

.NOTES
  Where each value comes from:
    CLOUDFLARE_API_KEY     dash.cloudflare.com -> My Profile -> API Tokens ->
                            Create Token -> scopes: Workers Scripts:Edit,
                            D1:Edit, Cloudflare Pages:Edit (an API *token*,
                            not the legacy global key)
    CLOUDFLARE_ACCOUNT_ID   dashboard sidebar (32-char hex)
    WOKWI_CLI_TOKEN         wokwi.com -> account -> CI tokens (optional; HIL-2
                            skips without it)
#>
[CmdletBinding()]
param(
    [switch]$GitHub,
    [switch]$Cloudflare,
    [switch]$All,
    [switch]$Provision,
    [switch]$DryRun,
    # Owner/name; auto-detected from the git remote when omitted.
    [string]$Repo = ''
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# == FILL ME IN ======================================================
# 'GENERATE'        -> script mints a random 32-byte base64 key.
# '<placeholder>'   -> skipped with a warning (fine for optional ones).

$GitHubSecrets = [ordered]@{
    CLOUDFLARE_API_KEY    = '<cloudflare-api-token-workers+d1+pages-edit>'
    CLOUDFLARE_ACCOUNT_ID = '<cloudflare-account-id-32-hex>'
    WOKWI_CLI_TOKEN       = '<optional-wokwi-ci-token>'
}

$WorkerSecrets = [ordered]@{
    AUTH_SECRET = 'GENERATE'   # HS256 signing key (Phase 1 house tokens)
}
# == END FILL ME IN ==================================================

if ($All) { $GitHub = $true; $Cloudflare = $true }
if (-not ($GitHub -or $Cloudflare -or $Provision)) {
    Write-Host 'Usage: setup-secrets.ps1 [-GitHub] [-Cloudflare] [-All] [-Provision] [-DryRun]'
    Write-Host 'See the comment header for the full walkthrough.'
    exit 1
}

function Test-Placeholder([string]$Value) {
    return $Value -match '^<.*>$' -or [string]::IsNullOrWhiteSpace($Value)
}

function New-RandomKey {
    # GetBytes on an instance, not the static Fill(): Fill() is .NET
    # Core only, so it throws MethodNotFound under Windows PowerShell
    # 5.1 (.NET Framework). Create()+GetBytes() exists on both, and
    # this script should not silently require pwsh 7 -- it fails after
    # the GitHub secrets are already set, leaving the run half done.
    $bytes = [byte[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

$script:setCount = 0
$script:skipped = @()

function Resolve-SecretValue([string]$Name, [string]$Value) {
    if ($Value -ceq 'GENERATE') {
        Write-Host "  $Name - generating random 32-byte key" -ForegroundColor DarkGray
        return New-RandomKey
    }
    if (Test-Placeholder $Value) {
        $script:skipped += $Name
        Write-Warning "$Name still a placeholder - skipped"
        return $null
    }
    return $Value
}

if ($Provision) {
    Write-Host '-- provision (one-time) --' -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host '  [dry-run] wrangler d1 create feedme2-db'
        Write-Host '  [dry-run] wrangler r2 bucket create feedme2-firmware'
        Write-Host '  [dry-run] wrangler pages project create feedme2-webapp --production-branch=main'
    } else {
        Push-Location backend
        try {
            pnpm exec wrangler d1 create feedme2-db
            pnpm exec wrangler r2 bucket create feedme2-firmware
            pnpm exec wrangler pages project create feedme2-webapp --production-branch=main
        } finally { Pop-Location }
        Write-Host ''
        Write-Host 'NOW: paste the printed database_id into backend/wrangler.toml' -ForegroundColor Yellow
    }
}

if ($GitHub) {
    Write-Host '-- GitHub Actions secrets --' -ForegroundColor Cyan
    if (-not $Repo) {
        $originUrl = git remote get-url origin 2>$null
        if ($originUrl -match 'github\.com[:/](.+?)(?:\.git)?$') { $Repo = $Matches[1] }
    }
    if (-not $Repo) { throw 'Could not detect the GitHub repo - pass -Repo owner/name.' }
    gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'gh is not authenticated - run `gh auth login` first.' }
    Write-Host "  repo: $Repo"

    foreach ($name in $GitHubSecrets.Keys) {
        $value = Resolve-SecretValue $name $GitHubSecrets[$name]
        if ($null -eq $value) { continue }
        if ($DryRun) {
            Write-Host "  [dry-run] gh secret set $name -R $Repo  (value hidden, $($value.Length) chars)"
        } else {
            $value | gh secret set $name -R $Repo
            if ($LASTEXITCODE -ne 0) { throw "gh secret set $name failed" }
            Write-Host "  set $name" -ForegroundColor Green
        }
        $script:setCount++
    }
}

if ($Cloudflare) {
    Write-Host '-- Cloudflare Worker secrets (feedme2-api) --' -ForegroundColor Cyan
    Push-Location backend
    try {
        foreach ($name in $WorkerSecrets.Keys) {
            $value = Resolve-SecretValue $name $WorkerSecrets[$name]
            if ($null -eq $value) { continue }
            if ($DryRun) {
                Write-Host "  [dry-run] wrangler secret put $name  (value hidden, $($value.Length) chars)"
            } else {
                # wrangler reads the secret from stdin (trailing
                # newline is trimmed) - the value never hits argv.
                $value | pnpm exec wrangler secret put $name
                if ($LASTEXITCODE -ne 0) { throw "wrangler secret put $name failed" }
                Write-Host "  set $name" -ForegroundColor Green
            }
            $script:setCount++
        }
    } finally { Pop-Location }
}

Write-Host ''
Write-Host "Done. $script:setCount secret(s) $(if ($DryRun) { 'planned' } else { 'set' })." -ForegroundColor Cyan
if ($script:skipped.Count -gt 0) {
    Write-Host "Skipped placeholders: $($script:skipped -join ', ')" -ForegroundColor Yellow
}
if (-not $DryRun -and $Cloudflare -and $WorkerSecrets.AUTH_SECRET -ceq 'GENERATE') {
    Write-Host 'Note: generated keys are NOT saved anywhere. Re-running with GENERATE'
    Write-Host 'rotates them (existing JWTs become invalid).'
}
