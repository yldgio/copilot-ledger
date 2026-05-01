# Agent auto-install instructions

Use these instructions when an agent needs to install `copilot-ledger` without changing source code.

## Files to install

Copy both files from this repository:

- `extension\extension.mjs`
- `extension\lib.mjs`

## Workspace install

Install into the current workspace when the extension should apply only to this repository.

```powershell
$target = ".\.github\extensions\copilot-ledger"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item ".\extension\extension.mjs" -Destination "$target\extension.mjs" -Force
Copy-Item ".\extension\lib.mjs" -Destination "$target\lib.mjs" -Force
```

Equivalent Unix/macOS commands:

```bash
target="./.github/extensions/copilot-ledger"
mkdir -p "$target"
cp ./extension/extension.mjs "$target/extension.mjs"
cp ./extension/lib.mjs "$target/lib.mjs"
```

## User install

Install into the user extension folder when the extension should apply to every Copilot CLI workspace for the current user.

```powershell
$target = Join-Path $HOME ".copilot\extensions\copilot-ledger"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item ".\extension\extension.mjs" -Destination "$target\extension.mjs" -Force
Copy-Item ".\extension\lib.mjs" -Destination "$target\lib.mjs" -Force
```

Equivalent Unix/macOS commands:

```bash
target="$HOME/.copilot/extensions/copilot-ledger"
mkdir -p "$target"
cp ./extension/extension.mjs "$target/extension.mjs"
cp ./extension/lib.mjs "$target/lib.mjs"
```

Reload extensions or restart Copilot CLI after copying the files.
