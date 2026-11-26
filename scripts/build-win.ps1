Set-Location $PSScriptRoot\..
$VER_CODE = Select-String -Path ".\src\utils\Consts.ts" -Pattern "VERSION = '(.*)'"
$VERSION = $VER_CODE.Matches.Groups[1].Value

Write-Output "Building Version $VERSION for Windows (x64)"

New-Item -Path "." -Name "build" -ItemType "directory" -Force | Out-Null

Write-Output "Building TypeScript..."
npx tsc
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "Bundling with ncc..."
node .\node_modules\@vercel\ncc\dist\ncc\cli.js build .\dist\AsphyxiaCore.js -o .\build-env --external pug --external ts-node --external node:sqlite
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "Setting up build-env..."
Push-Location ".\build-env"
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Copy-Item -Recurse -Force -Path "typescript" -Destination "node_modules\"
Pop-Location

Write-Output "Packing executable with @yao-pkg/pkg..."
node .\node_modules\@yao-pkg\pkg\lib-es5\bin.js .\build-env -t "node22-win-x64" -o .\build\asphyxia-core-x64 --options "no-warnings,experimental-sqlite"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path ".\icon.ico") {
  Write-Output "Applying icon.ico..."
  node .\node_modules\resedit-cli\dist\cli.js --in ".\build\asphyxia-core-x64.exe" --out ".\build\asphyxia-core-x64.iconed.exe" --icon "1,.\icon.ico"
  if ($LASTEXITCODE -eq 0) {
    Move-Item -Force ".\build\asphyxia-core-x64.iconed.exe" ".\build\asphyxia-core-x64.exe"
  }
}

Write-Output "Cleaning temporary build-env artifacts..."
Remove-Item -Recurse -Force ".\build-env\node_modules", ".\build-env\index.js", ".\build-env\xdg-open" -ErrorAction SilentlyContinue

Write-Output "Build complete: .\build\asphyxia-core-x64.exe"
