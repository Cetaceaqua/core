param(
    [string]$SavedataDir = ""
)

$ErrorActionPreference = "Stop"

function Write-Success { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info    { param($msg) Write-Host "  [..] $msg" -ForegroundColor Cyan }
function Write-Warn    { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  [XX] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Asphyxia CORE | NeDB to SQLite Migration" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Write-Info "Checking Node.js version..."
try {
    $nodeVersion = (node --version 2>&1).ToString().TrimStart('v')
    $parts = $nodeVersion.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
        Write-Fail "Node.js $nodeVersion detected. Version >= 22.5 is required."
        exit 1
    }
    Write-Success "Node.js $nodeVersion (compatible)"
} catch {
    Write-Fail "Node.js not found. Please install Node.js >= 22.5 first."
    exit 1
}

if ($SavedataDir -eq "") {
    $candidates = @(
        (Join-Path $PSScriptRoot "..\savedata"),
        (Join-Path (Get-Location) "savedata")
    )
    foreach ($c in $candidates) {
        $resolved = [System.IO.Path]::GetFullPath($c)
        if (Test-Path $resolved) {
            $SavedataDir = $resolved
            break
        }
    }
}

if ($SavedataDir -eq "" -or -not (Test-Path $SavedataDir)) {
    Write-Fail "Could not locate the savedata directory."
    exit 1
}

Write-Info "Savedata directory: $SavedataDir"
$script = Join-Path $PSScriptRoot "migrate-nedb-to-sqlite.js"
node --experimental-sqlite --no-warnings $script $SavedataDir

if ($LASTEXITCODE -eq 0) {
    Write-Success "Migration completed successfully!"
} else {
    Write-Fail "Migration completed with errors."
}
