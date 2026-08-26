param(
  [string]$PortableRoot = ".build/windows/portable",
  [string]$ManifestPath = "dist/windows-package-manifest.json",
  [int]$ObservationSeconds = 10
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ManifestPath)) {
  throw "Windows package manifest was not found at $ManifestPath"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if (-not $manifest.executableName) {
  throw "Windows package manifest does not contain executableName"
}

$exePath = Join-Path $PortableRoot $manifest.executableName
if (-not (Test-Path $exePath)) {
  throw "Packaged executable was not found at $exePath"
}

$logRoot = ".build/windows/smoke-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$stdoutPath = Join-Path $logRoot "stdout.log"
$stderrPath = Join-Path $logRoot "stderr.log"
Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$env:ELECTRON_ENABLE_LOGGING = "1"
$env:ELECTRON_ENABLE_STACK_DUMPING = "1"

Write-Host "Launching packaged Windows app: $exePath"
$process = Start-Process `
  -FilePath $exePath `
  -WorkingDirectory $PortableRoot `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

try {
  Start-Sleep -Seconds $ObservationSeconds
  $process.Refresh()

  if ($process.HasExited) {
    Write-Host "Packaged app exited during the startup observation window with code $($process.ExitCode)."
    if (Test-Path $stdoutPath) {
      Write-Host "--- packaged app stdout ---"
      Get-Content $stdoutPath -ErrorAction SilentlyContinue
    }
    if (Test-Path $stderrPath) {
      Write-Host "--- packaged app stderr ---"
      Get-Content $stderrPath -ErrorAction SilentlyContinue
    }
    throw "Packaged Windows application failed the startup smoke test."
  }

  Write-Host "Packaged app remained alive for $ObservationSeconds seconds; startup smoke test passed."
}
finally {
  if (-not $process.HasExited) {
    taskkill.exe /PID $process.Id /T /F | Out-Null
  }
}
