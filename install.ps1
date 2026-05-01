$ErrorActionPreference = "Stop"
$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $null }
$Target = Join-Path $env:USERPROFILE ".copilot\extensions\copilot-ledger"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$LocalExtension = if ($ScriptDir) { Join-Path $ScriptDir "extension\extension.mjs" } else { $null }
$LocalLib = if ($ScriptDir) { Join-Path $ScriptDir "extension\lib.mjs" } else { $null }
if ($LocalExtension -and (Test-Path $LocalExtension) -and $LocalLib -and (Test-Path $LocalLib)) {
    Copy-Item $LocalExtension -Destination (Join-Path $Target "extension.mjs") -Force
    Copy-Item $LocalLib -Destination (Join-Path $Target "lib.mjs") -Force
}
else {
    if (-not $env:COPILOT_LEDGER_RAW_BASE) {
        throw "Set COPILOT_LEDGER_RAW_BASE to the raw GitHub URL when running install.ps1 through irm."
    }
    $RawBase = $env:COPILOT_LEDGER_RAW_BASE.TrimEnd("/")
    Invoke-WebRequest -Uri "$($RawBase)/extension/extension.mjs" -OutFile (Join-Path $Target "extension.mjs")
    Invoke-WebRequest -Uri "$($RawBase)/extension/lib.mjs" -OutFile (Join-Path $Target "lib.mjs")
}
Write-Host "✓ copilot-ledger installed at $Target"
Write-Host "  Run /ledger init in any repo to start tracking."
