param(
  [int]$Port = 8000,
  [switch]$SkipTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "CoreView demo"
Write-Host "Repo: $Root"

if (-not $SkipTests) {
  $tests = @(
    'tests/test-data.js',
    'tests/test-scheduling.js',
    'tests/test-paging.js',
    'tests/test-threads.js',
    'tests/test-gil-scheduler.js',
    'tests/integration/threads-execution.test.js'
  )

  foreach ($test in $tests) {
    Write-Host ""
    Write-Host "==> node $test"
    node $test
    if ($LASTEXITCODE -ne 0) {
      throw "Test failed: $test"
    }
  }
}

$url = "http://localhost:$Port"
Write-Host ""
Write-Host "Starting static server on $url"
Write-Host "Open that URL in the browser. Press Ctrl+C here to stop the server."

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
  & python -m http.server $Port
  exit $LASTEXITCODE
}

$py = Get-Command py -ErrorAction SilentlyContinue
if ($py) {
  & py -3 -m http.server $Port
  exit $LASTEXITCODE
}

throw "Python was not found. Start the app manually with: python -m http.server $Port"
