# copilot-ledger — Technical Design Document

> A GitHub Copilot CLI extension that transparently collects usage data (tokens, costs, models, sessions) per repository, making it queryable by developers and team leads. Zero workflow change required.

---

## 1. Overview

**copilot-ledger** is a single Copilot CLI extension that:

1. Captures session telemetry (tokens, costs, models, code changes) via SDK events
2. Persists per-session records as JSONL at the repository level
3. Exposes query tools so the LLM can answer "how much Copilot usage happened?"
4. Provides a `/ledger` slash command for direct user interaction

No external dependencies beyond Node.js (provided by the Copilot CLI runtime) and git.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Copilot CLI Runtime                                    │
│                                                         │
│   ┌───────────────────────────────────────────────┐     │
│   │  copilot-ledger extension (extension.mjs)     │     │
│   │                                               │     │
│   │  ┌─────────────┐  ┌────────────────────────┐ │     │
│   │  │ Event       │  │ Tools & Commands        │ │     │
│   │  │ Listeners   │  │                         │ │     │
│   │  │             │  │ • ledger-summary        │ │     │
│   │  │ • start     │  │ • ledger-user           │ │     │
│   │  │ • user.msg  │  │ • ledger-team           │ │     │
│   │  │ • asst.msg  │  │ • ledger-init           │ │     │
│   │  │ • idle      │  │ • /ledger command       │ │     │
│   │  │ • shutdown  │  │                         │ │     │
│   │  └──────┬──────┘  └────────────┬────────────┘ │     │
│   │         │                      │              │     │
│   └─────────┼──────────────────────┼──────────────┘     │
│             │                      │                    │
└─────────────┼──────────────────────┼────────────────────┘
              │                      │
              ▼                      ▼
     ┌────────────────┐    ┌────────────────┐
     │ .ledger/       │    │ .ledger/       │
     │ *.jsonl        │◄───│ *.jsonl (read) │
     │ *.pending.json │    └────────────────┘
     └────────────────┘
```

**Key insight**: The Copilot CLI Extensions SDK provides exact token counts, model identity, cost multipliers, and repository context directly via events. No estimation or heuristics needed.

---

## 3. SDK Evidence

All types sourced from `~/.copilot/pkg/universal/1.0.39/copilot-sdk/`.

### 3.1 joinSession Configuration

```ts
joinSession({
  tools?: Tool<any>[],
  commands?: CommandDefinition[],
  hooks?: {},
})
```

### 3.2 Tool Interface

```ts
interface Tool<TArgs = unknown> {
  name: string;
  description?: string;
  parameters?: ZodSchema<TArgs> | Record<string, unknown>;
  handler: ToolHandler<TArgs>;
  skipPermission?: boolean;
}
```

### 3.3 CommandDefinition

```ts
interface CommandDefinition {
  name: string;
  description?: string;
  handler: CommandHandler;
}

interface CommandContext {
  sessionId: string;
  command: string;
  commandName: string;
  args: string;
}
```

### 3.4 StartData

```ts
interface StartData {
  sessionId: string;
  context?: WorkingDirectoryContext;
  copilotVersion: string;
  selectedModel?: string;
  reasoningEffort?: string;
}
```

### 3.5 WorkingDirectoryContext

```ts
interface WorkingDirectoryContext {
  cwd: string;
  gitRoot?: string;
  repository?: string;       // "owner/name" from git remote
  repositoryHost?: string;   // "github.com" etc.
  branch?: string;
  baseCommit?: string;
  headCommit?: string;
  hostType?: "github" | "ado";
}
```

### 3.6 ShutdownData

```ts
interface ShutdownData {
  shutdownType: "routine" | "error";
  sessionStartTime: number;        // Unix milliseconds
  totalPremiumRequests: number;
  totalApiDurationMs: number;
  currentModel?: string;
  codeChanges: ShutdownCodeChanges;
  modelMetrics: { [model: string]: ShutdownModelMetric };
  conversationTokens?: number;
  systemTokens?: number;
  toolDefinitionsTokens?: number;
  currentTokens?: number;
  errorReason?: string;
}

interface ShutdownCodeChanges {
  filesModified: string[];    // full paths — we store only count
  linesAdded: number;
  linesRemoved: number;
}

interface ShutdownModelMetric {
  requests: { count: number; cost: number };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens?: number;
  };
}
```

### 3.7 Mid-Session Events

| Event | Key Fields | Usage |
|-------|-----------|-------|
| `user.message` | `transformedContent` (string) | Increment `promptCount` |
| `assistant.message` | `outputTokens` (int), `tokenCount` (int) | Accumulate `outputTokensAccum` |
| `session.idle` | — | Write progressive pending file |

### 3.8 Real Shutdown Payload (captured)

```json
{
  "shutdownType": "routine",
  "totalPremiumRequests": 6,
  "totalApiDurationMs": 47184,
  "sessionStartTime": 1777632399853,
  "codeChanges": {
    "linesAdded": 2,
    "linesRemoved": 1,
    "filesModified": ["D:\\projects\\copilot-ledger\\.github\\extensions\\shutdown-test\\extension.mjs"]
  },
  "modelMetrics": {
    "claude-sonnet-4.6": {
      "requests": { "count": 16, "cost": 6 },
      "usage": {
        "inputTokens": 545374,
        "outputTokens": 1322,
        "cacheReadTokens": 530516,
        "cacheWriteTokens": 14830,
        "reasoningTokens": 0
      }
    }
  },
  "currentModel": "claude-sonnet-4.6",
  "currentTokens": 34777,
  "systemTokens": 11776,
  "conversationTokens": 3221,
  "toolDefinitionsTokens": 19776
}
```

---

## 4. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Extension-based collection | SDK provides exact token counts, session IDs, model info, and repository identity via `session.on()`. No heuristics needed. |
| 2 | User-scoped extension | Installed at `~/.copilot/extensions/copilot-ledger/`. Fires for every session in every repo. Workspace extensions (`.github/extensions/`) only work inside git repos. |
| 3 | Project-scoped storage only | Data stored in `.ledger/` at git root. No personal store in Phase 1. No collection outside git repos. |
| 4 | Per-user JSONL files | `{email_with_@_replaced}.jsonl` (e.g., `alice_company.com.jsonl`). Avoids merge conflicts. Team transparency is intentional. |
| 5 | Explicit init required | `.ledger/` must be created via `/ledger init`. Extension stays silent if absent, emits stderr nudge on session start. |
| 6 | Hybrid write strategy | `session.idle` overwrites `{sessionId}.pending.json`. `session.shutdown` appends final record to JSONL, deletes pending. Orphaned pending files promoted on next startup. |
| 7 | Dedup rule | Ignore shutdown events with `totalPremiumRequests === 0` (extension reload artifacts). |
| 8 | Developer identity | `git config --global user.email` → `git config user.email` → OS username. |
| 9 | `cwd` field | Relative path from git root to working directory. `"."` if at root. Enables monorepo service-level filtering. |
| 10 | Privacy | No file paths stored (only counts), no prompt content. Team visibility intentional. |
| 11 | Windows atomic append | Accepted risk for Phase 1. Per-user files make collisions near-impossible. |
| 12 | Code changes | `filesModified` stored as integer count, not paths. Avoids leaking filenames. |
| 13 | Query output formats | text (default, for LLM), csv (RFC 4180, for spreadsheets), html (self-contained single-file report). |
| 14 | No external dependencies | Node.js + git only. No jq, no SQLite in Phase 1. |
| 15 | Enterprise API | Deferred to Phase 2. |

---

## 5. Schema v1

### 5.1 Session Record (JSONL)

One JSON object per line, one line per completed session:

```json
{
  "v": 1,
  "sessionId": "a0fab732-...",
  "repo": "myorg/backend-api",
  "cwd": ".",
  "user": "alice@co.com",
  "startTime": 1777632399853,
  "endTime": 1777632698499,
  "shutdownType": "routine",
  "promptCount": 4,
  "premiumRequests": 6,
  "totalApiDurationMs": 47184,
  "currentModel": "claude-sonnet-4.6",
  "modelMetrics": {
    "claude-sonnet-4.6": {
      "requests": 16,
      "cost": 6,
      "inputTokens": 545374,
      "outputTokens": 1322,
      "cacheReadTokens": 530516,
      "cacheWriteTokens": 14830,
      "reasoningTokens": 0
    }
  },
  "codeChanges": {
    "linesAdded": 2,
    "linesRemoved": 1,
    "filesModified": 1
  }
}
```

### 5.2 Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `v` | `number` | Schema version. Always `1`. |
| `sessionId` | `string` | UUID from `StartData.sessionId`. |
| `repo` | `string` | `"owner/name"` from `WorkingDirectoryContext.repository`. |
| `cwd` | `string` | Relative path from git root to working directory. `"."` if at root. |
| `user` | `string` | Developer email or OS username. |
| `startTime` | `number` | Unix milliseconds from `ShutdownData.sessionStartTime`. |
| `endTime` | `number` | Unix milliseconds at shutdown event time. |
| `shutdownType` | `string` | One of: `"routine"`, `"error"`, `"recovered"`. |
| `promptCount` | `number` | Count of `user.message` events during session. |
| `premiumRequests` | `number` | From `ShutdownData.totalPremiumRequests`. |
| `totalApiDurationMs` | `number` | From `ShutdownData.totalApiDurationMs`. |
| `currentModel` | `string` | From `ShutdownData.currentModel`. |
| `modelMetrics` | `object` | Per-model token/cost breakdown (flattened). |
| `codeChanges` | `object` | Lines added/removed and file count. |

### 5.3 ModelMetric (flattened from SDK)

| Field | Type | Source |
|-------|------|--------|
| `requests` | `number` | `ShutdownModelMetric.requests.count` |
| `cost` | `number` | `ShutdownModelMetric.requests.cost` |
| `inputTokens` | `number` | `ShutdownModelMetric.usage.inputTokens` |
| `outputTokens` | `number` | `ShutdownModelMetric.usage.outputTokens` |
| `cacheReadTokens` | `number` | `ShutdownModelMetric.usage.cacheReadTokens` |
| `cacheWriteTokens` | `number` | `ShutdownModelMetric.usage.cacheWriteTokens` |
| `reasoningTokens` | `number` | `ShutdownModelMetric.usage.reasoningTokens` (default `0`) |

### 5.4 CodeChanges

| Field | Type | Source |
|-------|------|--------|
| `linesAdded` | `number` | `ShutdownCodeChanges.linesAdded` |
| `linesRemoved` | `number` | `ShutdownCodeChanges.linesRemoved` |
| `filesModified` | `number` | `ShutdownCodeChanges.filesModified.length` (count only) |

### 5.5 shutdownType Enum

| Value | Meaning |
|-------|---------|
| `"routine"` | Normal session exit (from SDK `ShutdownData.shutdownType`) |
| `"error"` | Crash or fatal error (from SDK `ShutdownData.shutdownType`) |
| `"recovered"` | Orphan promotion by crash recovery (copilot-ledger custom) |
| `"pending"` | Only in `.pending.json` files, never in final JSONL |

### 5.6 Pending File Format

Written to `.ledger/{sessionId}.pending.json` during active sessions:

```json
{
  "v": 1,
  "sessionId": "a0fab732-...",
  "repo": "myorg/backend-api",
  "cwd": ".",
  "user": "alice@co.com",
  "startTime": 1777632399853,
  "lastUpdate": 1777632500000,
  "shutdownType": "pending",
  "promptCount": 3,
  "outputTokensAccum": 847
}
```

---

## 6. Storage Layout

```
{git_root}/
└── .ledger/
    ├── .gitignore               # Contains: *.pending.json
    ├── alice_company.com.jsonl   # Committed; alice's sessions
    ├── bob_example.com.jsonl    # Committed; bob's sessions
    └── {sessionId}.pending.json  # Live session (gitignored)
```

**Filename derivation**: Replace `@` with `_` in the user email. Example: `alice@company.com` → `alice_company.com.jsonl`.

---

## 7. Extension Behavior (Full Pseudocode)

```js
// extension/extension.mjs
import { joinSession } from "@github/copilot-sdk/extension";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir, userInfo } from "node:os";

// ─── State ───────────────────────────────────────────────────────────────────
let sessionId = null;
let repo = null;
let cwd = ".";
let gitRoot = null;
let startTime = null;
let promptCount = 0;
let outputTokensAccum = 0;
let userId = null;
let ledgerDir = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserId() {
  try {
    const email = execSync("git config --global user.email", { encoding: "utf8" }).trim();
    if (email) return email;
  } catch {}
  try {
    const email = execSync("git config user.email", { encoding: "utf8" }).trim();
    if (email) return email;
  } catch {}
  return userInfo().username;
}

function safeFileName(user) {
  return user.replace("@", "_") + ".jsonl";
}

function getLedgerDir(gitRootPath) {
  if (!gitRootPath) return null;
  const dir = join(gitRootPath, ".ledger");
  return existsSync(dir) ? dir : null;
}

function computeRelativeCwd(actualCwd, gitRootPath) {
  if (!gitRootPath) return ".";
  const rel = relative(gitRootPath, actualCwd);
  return rel === "" ? "." : rel.replace(/\\/g, "/");
}

function flattenModelMetrics(sdkMetrics) {
  const result = {};
  for (const [model, metric] of Object.entries(sdkMetrics)) {
    result[model] = {
      requests: metric.requests.count,
      cost: metric.requests.cost,
      inputTokens: metric.usage.inputTokens,
      outputTokens: metric.usage.outputTokens,
      cacheReadTokens: metric.usage.cacheReadTokens,
      cacheWriteTokens: metric.usage.cacheWriteTokens,
      reasoningTokens: metric.usage.reasoningTokens ?? 0,
    };
  }
  return result;
}

function recoverOrphans(dir) {
  if (!dir) return;
  const files = readdirSync(dir).filter(f => f.endsWith(".pending.json"));
  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const pending = JSON.parse(readFileSync(filePath, "utf8"));
      const record = {
        v: 1,
        sessionId: pending.sessionId,
        repo: pending.repo,
        cwd: pending.cwd,
        user: pending.user,
        startTime: pending.startTime,
        endTime: pending.lastUpdate,
        shutdownType: "recovered",
        promptCount: pending.promptCount,
        premiumRequests: 0,
        totalApiDurationMs: 0,
        currentModel: null,
        modelMetrics: {},
        codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: 0 },
      };
      const jsonlPath = join(dir, safeFileName(pending.user));
      appendFileSync(jsonlPath, JSON.stringify(record) + "\n");
      unlinkSync(filePath);
    } catch {}
  }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const ledgerInitTool = {
  name: "ledger-init",
  description: "Initialize .ledger/ directory in the current git repository for usage tracking.",
  parameters: {},
  skipPermission: true,
  handler: async (args, context) => {
    if (!gitRoot) return { content: "Error: not in a git repository." };
    const dir = join(gitRoot, ".ledger");
    if (existsSync(dir)) return { content: ".ledger/ already exists." };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "*.pending.json\n");
    ledgerDir = dir;
    return { content: "Created .ledger/ with .gitignore. Ready to track usage." };
  },
};

const ledgerSummaryTool = {
  name: "ledger-summary",
  description: "Show aggregated Copilot usage summary for a repository.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Filter by repo (owner/name). Defaults to current." },
      days: { type: "number", description: "Number of days to look back. Default: 30." },
      format: { type: "string", enum: ["text", "csv", "html"], description: "Output format." },
    },
  },
  skipPermission: true,
  handler: async (args, context) => {
    const records = readRecords(args.repo, args.days);
    return { content: formatSummary(records, args.format || "text") };
  },
};

const ledgerUserTool = {
  name: "ledger-user",
  description: "Show Copilot usage breakdown for a specific user.",
  parameters: {
    type: "object",
    properties: {
      user: { type: "string", description: "User email. Defaults to current user." },
      days: { type: "number", description: "Number of days to look back. Default: 30." },
      format: { type: "string", enum: ["text", "csv", "html"], description: "Output format." },
    },
  },
  skipPermission: true,
  handler: async (args, context) => {
    const targetUser = args.user || userId;
    const records = readRecords(null, args.days).filter(r => r.user === targetUser);
    return { content: formatUserBreakdown(records, targetUser, args.format || "text") };
  },
};

const ledgerTeamTool = {
  name: "ledger-team",
  description: "Show Copilot usage for all team members in the current repository.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Number of days to look back. Default: 30." },
      format: { type: "string", enum: ["text", "csv", "html"], description: "Output format." },
    },
  },
  skipPermission: true,
  handler: async (args, context) => {
    const records = readRecords(repo, args.days);
    return { content: formatTeamBreakdown(records, args.format || "text") };
  },
};

// ─── Command ─────────────────────────────────────────────────────────────────

const ledgerCommand = {
  name: "ledger",
  description: "Query and manage Copilot usage tracking.",
  handler: async (context) => {
    const args = context.args.trim();
    if (args === "init" || args === "") {
      // delegate to init or show
    }
    if (args === "status") {
      // show .ledger/ status, pending files, record count
    }
    if (args.startsWith("show")) {
      // parse: show [repo] [last N days]
    }
    if (args.startsWith("top")) {
      // parse: top repos|users [this week|last N days]
    }
    // delegate to appropriate tool handler
  },
};

// ─── Data Reading ────────────────────────────────────────────────────────────

function readRecords(filterRepo, days) {
  if (!ledgerDir) return [];
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const records = [];
  const files = readdirSync(ledgerDir).filter(f => f.endsWith(".jsonl"));
  for (const file of files) {
    const lines = readFileSync(join(ledgerDir, file), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (filterRepo && record.repo !== filterRepo) continue;
        if (cutoff && record.startTime < cutoff) continue;
        records.push(record);
      } catch {}
    }
  }
  return records;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatSummary(records, format) {
  // Aggregate: session count, prompt count, premium requests,
  // per-model token totals, total code changes
  // Return as text table, CSV, or self-contained HTML
}

function formatUserBreakdown(records, user, format) {
  // Group by repo, show per-repo totals for the user
}

function formatTeamBreakdown(records, format) {
  // Group by user, show per-user totals
}

// ─── Session Registration ────────────────────────────────────────────────────

const session = joinSession({
  tools: [ledgerInitTool, ledgerSummaryTool, ledgerUserTool, ledgerTeamTool],
  commands: [ledgerCommand],
});

// ─── Crash Recovery ──────────────────────────────────────────────────────────
// Runs once at extension load time
userId = getUserId();
// gitRoot/ledgerDir set after session.start provides context

// ─── Event Listeners ─────────────────────────────────────────────────────────

session.on("session.start", (event) => {
  const data = event.data; // StartData
  sessionId = data.sessionId;
  startTime = data.sessionStartTime || Date.now();

  const ctx = data.context; // WorkingDirectoryContext
  if (ctx) {
    gitRoot = ctx.gitRoot || null;
    repo = ctx.repository || null;
    cwd = computeRelativeCwd(ctx.cwd, ctx.gitRoot);
  }

  ledgerDir = getLedgerDir(gitRoot);

  // Crash recovery on startup
  recoverOrphans(ledgerDir);

  // Nudge if .ledger/ doesn't exist
  if (gitRoot && !ledgerDir) {
    process.stderr.write("[copilot-ledger] No .ledger/ found. Run /ledger init to start tracking.\n");
  }
});

session.on("user.message", (event) => {
  promptCount++;
});

session.on("assistant.message", (event) => {
  const tokens = event.data?.outputTokens ?? event.data?.tokenCount ?? 0;
  outputTokensAccum += tokens;
});

session.on("session.idle", (event) => {
  if (!ledgerDir || !sessionId) return;
  const pending = {
    v: 1,
    sessionId,
    repo,
    cwd,
    user: userId,
    startTime,
    lastUpdate: Date.now(),
    shutdownType: "pending",
    promptCount,
    outputTokensAccum,
  };
  const filePath = join(ledgerDir, `${sessionId}.pending.json`);
  writeFileSync(filePath, JSON.stringify(pending));
});

session.on("session.shutdown", (event) => {
  const data = event.data; // ShutdownData

  // Dedup: skip zero-usage events (extension reloads)
  if (data.totalPremiumRequests === 0) return;

  if (!ledgerDir) return;

  const record = {
    v: 1,
    sessionId,
    repo,
    cwd,
    user: userId,
    startTime: data.sessionStartTime || startTime,
    endTime: Date.now(),
    shutdownType: data.shutdownType,
    promptCount,
    premiumRequests: data.totalPremiumRequests,
    totalApiDurationMs: data.totalApiDurationMs,
    currentModel: data.currentModel || null,
    modelMetrics: flattenModelMetrics(data.modelMetrics || {}),
    codeChanges: {
      linesAdded: data.codeChanges?.linesAdded ?? 0,
      linesRemoved: data.codeChanges?.linesRemoved ?? 0,
      filesModified: data.codeChanges?.filesModified?.length ?? 0,
    },
  };

  // Append to user's JSONL file
  const jsonlPath = join(ledgerDir, safeFileName(userId));
  appendFileSync(jsonlPath, JSON.stringify(record) + "\n");

  // Delete pending file
  const pendingPath = join(ledgerDir, `${sessionId}.pending.json`);
  try { unlinkSync(pendingPath); } catch {}
});
```

---

## 8. OTEL Mapping (Phase 2 Exporter)

| Ledger Field | OTEL Semantic Convention | Notes |
|---|---|---|
| `sessionId` | `session.id` | Standard |
| `repo` | `vcs.repository.url.full` | Exporter expands `org/name` to full URL |
| `cwd` | `copilot.working_directory` | Custom attribute |
| `user` | `enduser.id` | Standard |
| `currentModel` | `gen_ai.request.model` | GenAI semconv |
| `modelMetrics[m].inputTokens` | `gen_ai.usage.input_tokens` | Per-model span |
| `modelMetrics[m].outputTokens` | `gen_ai.usage.output_tokens` | Per-model span |
| `modelMetrics[m].reasoningTokens` | `gen_ai.usage.reasoning_tokens` | Custom (no semconv yet) |
| `modelMetrics[m].cacheReadTokens` | `gen_ai.usage.cache_read_tokens` | Custom |
| `modelMetrics[m].cacheWriteTokens` | `gen_ai.usage.cache_write_tokens` | Custom |
| `modelMetrics[m].requests` | `gen_ai.usage.request_count` | Custom |
| `modelMetrics[m].cost` | `gen_ai.usage.cost_multiplier` | Custom |
| `premiumRequests` | `copilot.premium_requests` | Custom |
| `totalApiDurationMs` | `copilot.api_duration_ms` | Custom |
| `promptCount` | `copilot.prompt_count` | Custom |
| `startTime` / `endTime` | Span start/end timestamps | Converted to nanoseconds |

---

## 9. Project Structure

```
copilot-ledger/
├── extension/
│   └── extension.mjs           # The entire extension (collection + tools + commands)
├── install.sh                   # Unix: copy extension to ~/.copilot/extensions/copilot-ledger/
├── install.ps1                  # Windows: same
├── copilot-ledger-design.md    # Technical design (schema reference, OTEL mapping, decisions)
├── docs/
│   └── adr/
│       └── 0002-extension-based-collection.md
├── AGENTS.md                   # Project instructions for AI assistants
└── README.md                   # User-facing documentation
```

---

## 10. Implementation Phases

### Phase 1: Full Extension + Install Scripts

**Goal**: Complete, working extension with all features (collection, tools, commands) plus install scripts.

**Files to create**:
- `extension/extension.mjs` — the complete extension
- `install.sh` — Unix installer
- `install.ps1` — Windows installer

**Scope**: Everything in §7 (full pseudocode), including:
- All helper functions (`getUserId`, `safeFileName`, `getLedgerDir`, `computeRelativeCwd`, `flattenModelMetrics`, `recoverOrphans`)
- All state variables
- All event handlers (`session.start`, `user.message`, `assistant.message`, `session.idle`, `session.shutdown`)
- All tools (`ledger-init`, `ledger-summary`, `ledger-user`, `ledger-team`)
- `/ledger` command with subcommand parsing
- All three output formatters (text, csv, html)
- `readRecords()` data reading function
- Crash recovery logic
- Install scripts (idempotent, both platforms)

**Functions to implement**:

| Function | Signature | Behavior |
|----------|-----------|----------|
| `getUserId()` | `() → string` | `git config --global user.email` → `git config user.email` → `os.userInfo().username` |
| `safeFileName(user)` | `(string) → string` | Replace `@` with `_`, append `.jsonl` |
| `getLedgerDir(gitRoot)` | `(string\|null) → string\|null` | Join gitRoot + `.ledger/`, return null if doesn't exist |
| `computeRelativeCwd(cwd, gitRoot)` | `(string, string) → string` | `path.relative()`, normalize separators to `/`, default `"."` |
| `flattenModelMetrics(sdkMetrics)` | `(object) → object` | Flatten `{requests: {count, cost}, usage: {...}}` → `{requests, cost, inputTokens, ...}` |
| `recoverOrphans(dir)` | `(string\|null) → void` | Scan `*.pending.json`, promote to JSONL with `shutdownType: "recovered"`, delete pending |
| `readRecords(filterRepo, days)` | `(string\|null, number\|null) → object[]` | Read all JSONL in ledgerDir, filter by repo/days |
| `formatSummary(records, format)` | `(object[], string) → string` | Aggregate and format as text/csv/html |
| `formatUserBreakdown(records, user, format)` | `(object[], string, string) → string` | Per-repo breakdown for one user |
| `formatTeamBreakdown(records, format)` | `(object[], string) → string` | Per-user totals |

**Tools**:

| Tool | Parameters (JSON Schema) | Behavior |
|------|-----------|----------|
| `ledger-init` | `{}` | Create `.ledger/` at git root with `.gitignore` containing `*.pending.json` |
| `ledger-summary` | `{ repo?: string, days?: number, format?: "text"\|"csv"\|"html" }` | Read all JSONL, filter, aggregate totals |
| `ledger-user` | `{ user?: string, days?: number, format?: "text"\|"csv"\|"html" }` | Filter by user, show cross-repo breakdown |
| `ledger-team` | `{ days?: number, format?: "text"\|"csv"\|"html" }` | Group by user, show per-user totals |

All tools: `skipPermission: true`.

**`/ledger` command parsing**:

| Input | Behavior |
|-------|----------|
| `/ledger init` | Delegate to `ledger-init` handler |
| `/ledger show` | Summary for current repo, last 30 days, text format |
| `/ledger show <repo> last <N> days` | Summary with specified repo and days |
| `/ledger top repos this week` | Group by repo, sort by premiumRequests desc, last 7 days |
| `/ledger top users this week` | Group by user, sort by premiumRequests desc, last 7 days |
| `/ledger status` | Show: ledgerDir path, record count, pending files, last session time |

**Aggregation fields** (for `formatSummary`):
- Total sessions, prompts, premium requests, API duration
- Per-model: requests, inputTokens, outputTokens, cacheReadTokens, cost
- Total code changes: linesAdded, linesRemoved, filesModified

**Output formats**:
- **text**: Aligned columns with headers
- **csv**: RFC 4180, header row, one row per session (summary) or per group (aggregated)
- **html**: Self-contained, inline CSS, summary table + per-model breakdown

**Install scripts**:

`install.sh`:
```bash
#!/bin/bash
set -e
TARGET="$HOME/.copilot/extensions/copilot-ledger"
mkdir -p "$TARGET"
cp extension/extension.mjs "$TARGET/extension.mjs"
echo "copilot-ledger installed at $TARGET"
echo "Run /ledger init in any repo to start tracking."
```

`install.ps1`:
```powershell
$Target = Join-Path $env:USERPROFILE ".copilot\extensions\copilot-ledger"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item "extension\extension.mjs" -Destination (Join-Path $Target "extension.mjs") -Force
Write-Host "copilot-ledger installed at $Target"
Write-Host "Run /ledger init in any repo to start tracking."
```

**Acceptance criteria**:
- `node --check extension/extension.mjs` passes (no syntax errors)
- Install scripts are idempotent
- Extension placed at `~/.copilot/extensions/copilot-ledger/extension.mjs`
- All tools return `{ content: string }` responses
- `/ledger` command handles all subcommands without crashing

---

### Phase 2: Manual Smoke Test

**Goal**: Verify the extension works in a real Copilot CLI session.

**Steps** (performed by developer):
1. Run `./install.ps1` (or `./install.sh`)
2. In any git repo, run `/ledger init` → verify `.ledger/` created with `.gitignore`
3. Chat with Copilot (at least 2 prompts)
4. Exit session
5. Check `.ledger/{user}.jsonl` — verify one valid JSON line with all schema v1 fields
6. Start new session, run `/ledger show` — verify output shows the previous session
7. Run `/ledger status` — verify record count = 1

**Acceptance criteria**:
- JSONL record has: `v`, `sessionId`, `repo`, `cwd`, `user`, `startTime`, `endTime`, `shutdownType`, `promptCount`, `premiumRequests`, `totalApiDurationMs`, `currentModel`, `modelMetrics`, `codeChanges`
- `premiumRequests > 0`, `promptCount > 0`, `modelMetrics` has at least one model entry
- `/ledger show` displays a readable summary

---

### Phase 3: README

**Goal**: User-facing documentation.

**File to create**: `README.md`

**Structure**:
1. What is copilot-ledger (one paragraph)
2. Installation (`install.sh` / `install.ps1`)
3. Initialization (`/ledger init`)
4. Usage examples (natural language queries + `/ledger` commands)
5. Privacy guarantees (what's stored, what's not)
6. Schema overview (brief, links to `copilot-ledger-design.md` §5 for full reference)
7. OTEL mapping (brief, links to `copilot-ledger-design.md` §8)
8. Evolutionary roadmap (Phases 2-4 from §11)

**Acceptance criteria**:
- Installation steps are copy-paste executable
- All `/ledger` subcommands documented with examples
- Privacy section clearly states: no file paths, no prompt content, counts only
- Links to design doc for detailed schema and OTEL mapping (no duplication)

---

## 11. Evolutionary Roadmap

### Phase 2 — Enterprise API + OTEL Export

- OTLP exporter translates session records to resource spans using the mapping in Section 8
- Enterprise Metrics API enrichment for reconciliation against actual billing
- Archival/pruning for long-lived repos
- `~/.copilot-ledger/` personal store fallback for non-git usage

### Phase 3 — Multi-Editor Coverage

- VS Code extension
- JetBrains plugin
- Unified event log format across all editors

### Phase 4 — Policy & Governance

- Budget alerts (threshold-based notifications)
- Cost forecasting (trend extrapolation)
- BI integration (Power BI / Looker connectors)

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Extension SDK changes (undocumented API) | Medium | High | Pin to SDK version; `.d.ts` types are versioned; degrade gracefully on unknown shapes |
| `session.shutdown` doesn't fire (killed process) | Medium | Low | Pending files capture progressive data; crash recovery promotes orphans |
| Windows atomic append collision | Very Low | Low | Per-user files make concurrent writes near-impossible |
| JSONL grows unboundedly | Medium | Low | One line per session = years before meaningful size; Phase 2 adds archival |
| Developer has no git email configured | Low | Low | Falls back to OS username; documented in README |
| `filesModified` contains sensitive paths | N/A | N/A | Mitigated: we store count only, not paths |

---

## 13. Non-Goals (Phase 1)

- VS Code / JetBrains coverage
- Cloud/coding-agent coverage
- Enterprise Metrics API integration
- Personal store (`~/.copilot-ledger/`)
- Billing integration or chargebacks
- Cross-machine aggregation
- SQLite or any database

---

## 14. References

### Copilot CLI
- Product page: https://github.com/features/copilot/cli
- GA announcement (Feb 2026): https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/

### Extensions SDK (local, undocumented)
- SDK types: `~/.copilot/pkg/universal/1.0.39/copilot-sdk/types.d.ts`
- Session events: `~/.copilot/pkg/universal/1.0.39/copilot-sdk/generated/session-events.d.ts`
- Extension entry: `~/.copilot/pkg/universal/1.0.39/copilot-sdk/extension.d.ts`

### Enterprise Metrics API (Phase 2)
- REST API: https://docs.github.com/en/rest/copilot/copilot-usage-metrics
- CLI activity in metrics: https://github.blog/changelog/2026-02-27-copilot-usage-metrics-now-includes-enterprise-level-github-copilot-cli-activity/

### OTEL
- GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
