# Paddy installer (Windows / PowerShell). Pulls this repo, runs npm install,
# and puts the `paddy` command on the user PATH.
#
#   irm https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.ps1 | iex
param(
  [string]$Repo = "coruairc/paddy-gui",
  [string]$Ref = "main",
  [string]$GitDir = "$env:LOCALAPPDATA\paddy-gui",
  [string]$BinDir = "$env:LOCALAPPDATA\paddy-gui\bin",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"

function Say([string]$Line) { Write-Host "==> $Line" }
function Die([string]$Line) { Write-Host "paddy install: $Line" -ForegroundColor Red; exit 1 }

Say "Paddy · $Repo@$Ref"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "git is required. Install Git for Windows: https://git-scm.com/download/win"
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
$npm  = (Get-Command npm  -ErrorAction SilentlyContinue)
if (-not $node -or -not $npm) {
  Die "Node.js 22+ is required. Install from https://nodejs.org then re-run."
}
$major = [int](node -v -replace 'v', '').split('.')[0]
if ($major -lt 22) {
  Die "Node.js $major is too old. Need 22+. Install from https://nodejs.org"
}

if (-not (Test-Path $GitDir)) { New-Item -ItemType Directory -Path $GitDir -Force | Out-Null }

Push-Location $GitDir
try {
    if (Test-Path ".git") {
      Say "updating $GitDir"
      git fetch --depth 1 origin $Ref
      git reset --hard FETCH_HEAD
    } else {
      Say "cloning https://github.com/$Repo.git -> $GitDir"
      git clone --depth 1 --branch $Ref "https://github.com/$Repo.git" .
    }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $GitDir "bin\paddy.mjs"))) {
  Die "checkout is missing bin\paddy.mjs — is $Repo the Paddy repo?"
}

Say "npm install"
Push-Location $GitDir
try {
    npm install --no-fund --no-audit
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$wrapper = Join-Path $BinDir "paddy.cmd"
$cli = Join-Path $GitDir "bin\paddy.mjs"
@"
@echo off
node "$cli" %*
"@ | Set-Content -Path $wrapper -Encoding ASCII -NoNewline

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$paths = $userPath -split ";" | Where-Object { $_ -and $_.Trim() }
if (-not ($paths -contains $BinDir)) {
  $paths += $BinDir
  $newPath = ($paths -join ";")
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Say "added $BinDir to user PATH"
}

Write-Host ""
Write-Host "Paddy installed" -ForegroundColor Green
Write-Host ""
Write-Host "  paddy              # start the desk"
Write-Host "  paddy update       # pull the latest"
Write-Host "  paddy doctor       # install + runtime info"
Write-Host "  paddy uninstall    # remove the wrapper"
Write-Host ""
Write-Host "Open this terminal again so the wrapper is on PATH, then run:"
Write-Host "  paddy"
Write-Host ""