# copilot-ledger

A GitHub Copilot CLI extension that transparently collects usage data — tokens, costs, models, and sessions — attributed to each repository. Query your Copilot usage with natural language or structured commands, individually or across your team. Zero workflow change required: just use Copilot as usual.

---

## Installation

> **Requires:** [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (not VS Code Copilot).

**Unix/macOS:**
```bash
git clone https://github.com/{owner}/copilot-ledger.git
cd copilot-ledger
./install.sh
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/{owner}/copilot-ledger.git
cd copilot-ledger
.\install.ps1
```

Both scripts copy `extension/extension.mjs` to `~/.copilot/extensions/copilot-ledger/extension.mjs`.

---

## Getting Started

1. Open Copilot CLI in any git repository
2. Run `/ledger init` — creates a `.ledger/` directory with a `.gitignore`
3. Use Copilot normally — data is collected automatically each session
4. Query with `/ledger show` or natural language ("how much Copilot did I use this week?")

---

## Commands Reference

All commands use the `/ledger` slash command:

| Command | Description |
|---------|-------------|
| `/ledger init` | Initialize `.ledger/` in the current repo |
| `/ledger` or `/ledger show` | Summary for the current repo, last 30 days |
| `/ledger show owner/repo last 7 days` | Summary for a specific repo and time window |
| `/ledger top repos this week` | Repos ranked by premium requests (last 7 days) |
| `/ledger top users this week` | Users ranked by premium requests (last 7 days) |
| `/ledger status` | Show ledger directory, file count, record count, and pending files |

---

## Tools (LLM-callable)

The extension registers four tools the LLM can call automatically in response to natural language:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ledger-init` | — | Initialize `.ledger/` directory |
| `ledger-summary` | `repo?`, `days?`, `format?` | Summarize usage for a repo |
| `ledger-user` | `user?`, `days?`, `format?` | Show usage for a specific user |
| `ledger-team` | `days?`, `format?` | Show usage grouped by team member |

The `format` parameter accepts: `text` (default), `csv`, `html`.

Example natural language queries:
- "How much Copilot did I use this week?"
- "Show me team usage for the last 7 days as CSV"
- "Which repos used the most premium requests this month?"

---

## Output Formats

**text** (default) — aligned columns for terminal readability:
```
copilot-ledger · myorg/backend · last 30 days
──────────────────────────────────────────────
Sessions:           12
Prompts:            47
Premium Requests:   83
API Duration:       312.4s

Model Breakdown:
  claude-sonnet-4.6    requests: 64  cost: 24  in: 2.1M  out: 45K

Code Changes:
  +234 / -89 lines · 18 files modified
```

**csv** — RFC 4180 with header row, suitable for spreadsheets and scripts.

**html** — self-contained document with inline CSS, suitable for sharing and reporting.

---

## What's Collected (Privacy)

**Stored per session:**
- Session ID, repo name, relative working directory
- User email (from git config)
- Timestamps (start, end)
- Prompt count, premium request count
- Per-model token counts (input, output, cache read/write, reasoning)
- Per-model request count and cost
- Code change stats (lines added/removed, count of files modified)

**NOT stored:**
- File paths (only the count of modified files)
- Prompt content or assistant responses
- API keys or credentials
- Anything outside the session metadata

All data lives in `.ledger/` at the git root. Each user gets their own `.jsonl` file (e.g., `alice_example.com.jsonl`), avoiding merge conflicts in shared repositories.

---

## How It Works

1. Extension loads when Copilot CLI starts
2. In the `onSessionStart` hook: captures session ID, repo folder (`data.cwd`), and the initial prompt when present
3. On each `user.message`: increments the prompt counter and estimates input tokens from `transformedContent`
4. On `assistant.message`: accumulates SDK-provided `outputTokens`
5. On `session.idle`: writes a pending checkpoint (gitignored as `*.pending.json`)
6. On `session.shutdown`: writes the final JSONL record and deletes the pending file
7. On the next `onSessionStart`: recovers any orphaned `.pending.json` files left by crashed sessions

> The `.ledger/` directory must be explicitly initialized with `/ledger init`. The extension will nudge you if it hasn't been set up yet, but will not auto-create it.

---

## Storage Format

One JSON line per session in `.ledger/{user}.jsonl`. Schema version: `v: 1`.

For the full schema reference, see [copilot-ledger-design.md §5](copilot-ledger-design.md).

---

## OTEL Compatibility

Field names align with OpenTelemetry GenAI semantic conventions where possible, enabling future OTLP export.

For the full mapping table, see [copilot-ledger-design.md §8](copilot-ledger-design.md).

---

## Roadmap

- **Phase 2**: Enterprise Metrics API integration, OTLP export, archival/pruning
- **Phase 3**: VS Code and JetBrains support
- **Phase 4**: Budget alerts, cost forecasting, BI connectors
