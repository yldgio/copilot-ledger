$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = Join-Path $env:USERPROFILE ".copilot\extensions\copilot-ledger"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item (Join-Path $ScriptDir "extension\extension.mjs") -Destination (Join-Path $Target "extension.mjs") -Force
Write-Host "✓ copilot-ledger installed at $Target"
Write-Host "  Run /ledger init in any repo to start tracking."
