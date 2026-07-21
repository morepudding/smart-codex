$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$electronPath = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
$smokeDataPath = [IO.Path]::GetFullPath((Join-Path $projectRoot ".smart-codex-smoke-$PID"))
$safeRoot = [IO.Path]::GetFullPath($projectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (!(Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  throw "Electron executable not found: $electronPath"
}
if (!$smokeDataPath.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe smoke data path: $smokeDataPath"
}

$env:SMART_CODEX_SMOKE_TEST = "1"
Push-Location $projectRoot
try {
  New-Item -ItemType Directory -Path $smokeDataPath -Force | Out-Null
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& $electronPath "--user-data-dir=$smokeDataPath" "--disable-gpu" $projectRoot 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
} finally {
  Pop-Location
  Remove-Item Env:SMART_CODEX_SMOKE_TEST -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $smokeDataPath) { Remove-Item -LiteralPath $smokeDataPath -Recurse -Force }
}

$output | ForEach-Object { Write-Output $_ }

if ($exitCode -ne 0) {
  throw "Electron smoke test failed with code $exitCode."
}
if ($output -notcontains "SMART_CODEX_RENDERER_READY" -or $output -notcontains "SMART_CODEX_MARKDOWN_READY") {
  throw "Electron smoke test did not receive the expected renderer markers."
}

Write-Output "Electron renderer and secure GFM Markdown loaded successfully."
