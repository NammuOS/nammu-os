param(
  [string]$Executable = "src-tauri\target\release\nammu-os.exe",
  [int]$DebugPort = 9333,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS

try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$DebugPort"
  $startedAt = Get-Date
  $process = Start-Process -FilePath $resolvedExecutable -PassThru
} finally {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
}

$targets = $null
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Milliseconds 250
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 1
  } catch {
    $targets = $null
  }
} while (-not $targets -and (Get-Date) -lt $deadline)

[pscustomobject]@{
  processId = $process.Id
  debugPort = $DebugPort
  devToolsReady = [bool]$targets
  devToolsReadyMs = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds)
  targetCount = @($targets).Count
} | ConvertTo-Json -Compress

if (-not $targets) {
  exit 1
}
