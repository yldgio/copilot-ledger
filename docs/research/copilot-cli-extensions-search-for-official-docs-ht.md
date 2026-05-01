# GitHub Copilot CLI Extensions: Complete Research Report

## Executive Summary

GitHub Copilot CLI has **two distinct extensibility systems**: (1) **Extensions** — a low-level, programmatic system using `.github/extensions/extension.mjs` files that communicate over JSON-RPC, and (2) **Plugins** — a higher-level, distributable package system using `plugin.json` manifests. The Extensions system has essentially **no official public documentation** on docs.github.com, while Plugins have full official docs. The `@github/copilot-sdk` used by extensions is **not installed in global `node_modules`** — it's bundled inside the CLI's internal package directory at `~/.copilot/pkg/universal/<version>/copilot-sdk/` and auto-resolved at runtime. When installed via `npm install -g @github/copilot`, the CLI binary itself goes into global `node_modules`, but the SDK remains internal.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     COPILOT CLI EXTENSIBILITY                             │
├─────────────────────────────────┬───────────────────────────────────────┤
│  EXTENSIONS (Low-Level)         │  PLUGINS (High-Level)                  │
│  .github/extensions/            │  plugin.json manifests                 │
│  ~/.copilot/extensions/         │  Installable packages                  │
│  ES modules (.mjs only)         │  Agents, skills, hooks, MCP, LSP      │
│  JSON-RPC over stdio            │  Marketplace distribution              │
│  @github/copilot-sdk            │  copilot plugin install                │
│  Full programmatic control      │  Declarative configuration             │
│  Zero official docs             │  Full official docs                    │
└─────────────────────────────────┴───────────────────────────────────────┘
```

### How Extensions Work

```
┌─────────────────────┐      JSON-RPC / stdio       ┌──────────────────────┐
│   Copilot CLI        │ ◄──────────────────────────► │  Extension Process   │
│   (parent process)   │   tool calls, events, hooks  │  (forked child)      │
│                      │                               │                      │
│  • Discovers exts    │                               │  • Registers tools   │
│  • Forks processes   │                               │  • Registers hooks   │
│  • Routes tool calls │                               │  • Listens to events │
│  • Manages lifecycle │                               │  • Uses SDK APIs     │
└─────────────────────┘                               └──────────────────────┘
```

---

## 1. The Extensions System (`.github/extensions/`)

### Official Documentation Status

**There is no official public documentation on docs.github.com for the Extensions system.**[^1] The only authoritative sources are:

1. The bundled SDK `.d.ts` type definitions inside the CLI package[^2]
2. Internal docs shipped with the SDK at `~/.copilot/pkg/universal/<version>/copilot-sdk/docs/`[^3]
3. The community guide at htek.dev[^4]

The internal SDK documentation consists of three files:
- `extensions.md` — Architecture overview, discovery rules, lifecycle[^3]
- `agent-author.md` — Step-by-step workflow, complete type signatures, gotchas[^5]
- `examples.md` — Practical code examples for tools, hooks, events[^6]

### How Discovery and Module Resolution Works

**Discovery rules:**
1. CLI scans `.github/extensions/` (project-scoped, relative to git root)[^3]
2. CLI scans `~/.copilot/extensions/` (user-scoped, persists across repos)[^3]
3. Only immediate subdirectories are checked (not recursive)[^5]
4. Each subdirectory must contain a file named `extension.mjs`[^5]
5. Project extensions shadow user extensions on name collision[^5]

**SDK Resolution — NOT from global `node_modules`:**

The `@github/copilot-sdk` import is resolved **automatically by the CLI's internal module resolver** — you never install it yourself[^3]. The SDK lives at:

```
~/.copilot/pkg/universal/<version>/copilot-sdk/
```

On this system (Windows, CLI v1.0.39), it's located at:
```
C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\
```

This directory contains[^2]:
- `index.js` / `index.d.ts` — Main SDK exports
- `extension.js` / `extension.d.ts` — Extension-specific `joinSession()` API
- `client.d.ts` — CopilotClient for standalone mode
- `session.d.ts` — Session types
- `types.d.ts` — All type definitions
- `docs/` — Internal documentation

**Key point**: When an extension does `import { joinSession } from "@github/copilot-sdk/extension"`, the CLI intercepts this import via a custom module resolver during the fork. The package is NOT in `node_modules` anywhere — it's resolved from the CLI's internal `pkg` directory[^3][^7].

### The Minimal Extension

```js
import { joinSession } from "@github/copilot-sdk/extension";

const session = await joinSession({
    tools: [],      // Custom tools the agent can call
    hooks: {},      // Lifecycle hooks
});
```

This establishes the JSON-RPC connection over stdio and attaches to the user's foreground session[^3][^5].

### Extension Lifecycle

1. **Discovery** — CLI scans extension directories on startup[^3]
2. **Launch** — Each extension is forked as a child process with automatic SDK resolution[^3]
3. **Connection** — Extension calls `joinSession()` which establishes JSON-RPC link[^3]
4. **Registration** — Tools and hooks are registered with the CLI, available immediately[^3]
5. **Lifecycle** — Extensions are reloaded on `/clear` and stopped on CLI exit (SIGTERM, then SIGKILL after 5s)[^3]

### Available Hooks

| Hook | Fires When | Can Return |
|------|-----------|------------|
| `onSessionStart` | Session starts/resumes | `additionalContext` |
| `onUserPromptSubmitted` | User sends a message | `modifiedPrompt`, `additionalContext` |
| `onPreToolUse` | Before tool executes | `permissionDecision`, `modifiedArgs`, `additionalContext` |
| `onPostToolUse` | After tool executes | `modifiedResult`, `additionalContext` |
| `onErrorOccurred` | Error occurs | `errorHandling` (retry/skip/abort), `retryCount` |
| `onSessionEnd` | Session ends | `sessionSummary`, `cleanupActions` |

[^5]

### Session Events (10+ types)

| Event | Key Data Fields |
|-------|----------------|
| `assistant.message` | `content`, `messageId`, `toolRequests` |
| `assistant.turn_start` | `turnId` |
| `assistant.streaming_delta` | `totalResponseSizeBytes` |
| `tool.execution_start` | `toolCallId`, `toolName`, `arguments` |
| `tool.execution_complete` | `toolCallId`, `toolName`, `success`, `result`, `error` |
| `user.message` | `content`, `attachments`, `source` |
| `session.idle` | `backgroundTasks` |
| `session.error` | `errorType`, `message`, `stack` |
| `session.shutdown` | `shutdownType`, `totalPremiumRequests`, `codeChanges` |
| `permission.requested` | `requestId`, `permissionRequest.kind` |

[^6]

### Session API

After `joinSession()`, the returned `session` provides[^5][^6]:

- **`session.send(options)`** — Send a message programmatically (fire-and-forget)
- **`session.sendAndWait(options, timeout?)`** — Send and block until agent finishes
- **`session.log(message, options?)`** — Log to CLI timeline (levels: info, warning, error)
- **`session.on(eventType, handler)`** — Subscribe to events; returns unsubscribe function
- **`session.workspacePath`** — Path to session workspace directory
- **`session.rpc`** — Low-level typed RPC access to all session APIs
- **`session.rpc.ui.elicitation()`** — Present structured form dialogs to the user

### Hot Reload Workflow

1. CLI scaffolds extension: `extensions_manage({ operation: "scaffold", name: "my-ext" })`
2. Edit the generated `extension.mjs`
3. Reload: `extensions_reload({})` — new tools available immediately mid-session
4. Verify: `extensions_manage({ operation: "list" })`

[^4][^5]

### CLI Management Commands (v1.0.5+)

```
/extensions list           — Show all installed extensions and status
/extensions enable <name>  — Enable a specific extension
/extensions disable <name> — Disable without removing files
/extensions reload         — Hot-reload all active extensions
/extensions info <name>    — Show registered tools, hooks, commands
```

[^4]

### Known Bugs

1. **Hook Overwrite Bug** — If multiple extensions register hooks, only the last-loaded extension's hooks fire. Others are silently overwritten. Workaround: Use one "hooks extension" and use events in others. Tracking: [github/copilot-cli#2076](https://github.com/github/copilot-cli/issues/2076)[^4]
2. **onSessionStart context dropped** — Fixed in v1.0.11. Before that version, `additionalContext` from `onSessionStart` was silently ignored. Tracking: [github/copilot-cli#2142](https://github.com/github/copilot-cli/issues/2142)[^4]
3. **Extension load order undefined** — The order extensions are discovered is not guaranteed[^4]
4. **Tool name collisions are fatal** — If two extensions register the same tool name, the second fails to load entirely[^5]

---

## 2. The Plugin System (Official, Documented)

### Official Documentation

The Plugin system **has full official documentation** on docs.github.com:

- [About plugins for GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins)[^8]
- [Creating a plugin for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)[^9]
- [Finding and installing plugins for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)[^10]
- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/cli-plugin-reference)[^11]

### What Plugins Contain

A plugin is a distributable package that bundles[^8]:
- **Custom agents** — `*.agent.md` files in `agents/`
- **Skills** — `SKILL.md` files in `skills/<name>/`
- **Hooks** — `hooks.json` configuration
- **MCP server configs** — `.mcp.json`
- **LSP server configs** — `lsp.json`

### Plugin Structure

```
my-plugin/
├── plugin.json           # Required manifest
├── agents/               # Custom agents (optional)
│   └── helper.agent.md
├── skills/               # Skills (optional)
│   └── deploy/
│       └── SKILL.md
├── hooks.json            # Hook configuration (optional)
└── .mcp.json             # MCP server config (optional)
```

[^9]

### Installation Methods

| Method | Command |
|--------|---------|
| From marketplace | `copilot plugin install PLUGIN@MARKETPLACE` |
| From GitHub repo | `copilot plugin install OWNER/REPO` |
| From repo subdirectory | `copilot plugin install OWNER/REPO:PATH/TO/PLUGIN` |
| From Git URL | `copilot plugin install https://github.com/o/r.git` |
| From local path | `copilot plugin install ./my-plugin` |

[^10][^11]

### Default Marketplaces

Two marketplaces come pre-registered[^8]:
- [github/copilot-plugins](https://github.com/github/copilot-plugins)
- [github/awesome-copilot](https://github.com/github/awesome-copilot)

### Plugin vs Extension Comparison

| Feature | Extensions (`.github/extensions/`) | Plugins (`plugin.json`) |
|---------|-----------------------------------|------------------------|
| Official docs | ❌ None | ✅ Full |
| Runtime | Full Node.js process (JSON-RPC) | Declarative config |
| Distribution | Manual (commit to repo) | Marketplace, GitHub repo, local |
| Programmatic control | Full (tools, hooks, events, messaging) | Limited (hooks.json only) |
| Hot reload | ✅ `/extensions reload` | Requires reinstall |
| Custom tools | ✅ Unlimited via handler functions | Via MCP servers only |
| Event streaming | ✅ 10+ event types | ❌ Not available |
| Prompt rewriting | ✅ `modifiedPrompt` | ❌ Not available |
| Permission control | ✅ `allow`/`deny`/`ask` with reasons | ❌ Not available |
| Argument modification | ✅ `modifiedArgs` | ❌ Not available |
| Stateful | ✅ Persistent in-memory state | ❌ Stateless |
| Multi-language | ❌ .mjs only | N/A (declarative) |

---

## 3. Installation and Global `node_modules`

### How Copilot CLI Is Installed

The CLI can be installed multiple ways[^12]:

| Method | Command | Where It Lives |
|--------|---------|---------------|
| npm (global) | `npm install -g @github/copilot` | `<npm-global>/node_modules/@github/copilot/` |
| WinGet | `winget install GitHub.Copilot` | Program Files |
| Homebrew | `brew install copilot-cli` | Cellar |
| Install script | `curl -fsSL https://gh.io/copilot-install \| bash` | `~/.local/bin/` or `/usr/local/bin/` |
| VS Code extension | Built-in via `github.copilot-chat` | VS Code globalStorage |

### The npm Global Install Path

When installed via `npm install -g @github/copilot`, the CLI package goes to:
```
C:\Program Files\nodejs\node_modules\@github\copilot\   (Windows)
/usr/local/lib/node_modules/@github/copilot/            (macOS/Linux)
```

The npm package name is **`@github/copilot`**[^12].

### Where the Actual Runtime Lives

Regardless of installation method, the CLI's runtime packages (including the SDK) are stored in:
```
~/.copilot/pkg/universal/<version>/
```

This directory contains[^13]:
- `copilot-sdk/` — The extension SDK (auto-resolved for extensions)
- `builtin-skills/` — Built-in skill definitions
- `definitions/` — Type definitions
- `prebuilds/` — Platform-specific native modules
- `ripgrep/` — Bundled ripgrep binary
- `worker/` — Worker threads

### SDK Module Resolution (Critical Detail)

**The `@github/copilot-sdk` is NOT in global `node_modules`.** When the CLI forks an extension process, it sets up a custom module resolver that maps:

```
import "@github/copilot-sdk"          → ~/.copilot/pkg/universal/<version>/copilot-sdk/index.js
import "@github/copilot-sdk/extension" → ~/.copilot/pkg/universal/<version>/copilot-sdk/extension.js
```

This happens transparently — extension authors just write `import { joinSession } from "@github/copilot-sdk/extension"` and it works without any `npm install`[^3][^7].

The `extension.js` file itself uses `__module.createRequire(import.meta.url)` to set up its own module resolution context[^14].

---

## 4. The htek.dev Article Analysis

The article at [htek.dev/articles/github-copilot-cli-extensions-complete-guide](https://htek.dev/articles/github-copilot-cli-extensions-complete-guide) is the **most comprehensive public resource** on the Extensions system[^4]. Key claims verified against the actual SDK:

| Claim | Verified |
|-------|----------|
| Extensions use JSON-RPC over stdio | ✅ Confirmed by SDK docs[^3] |
| Entry point must be `extension.mjs` | ✅ Confirmed[^5] |
| `@github/copilot-sdk` auto-resolved | ✅ Confirmed[^3] |
| 6 lifecycle hooks available | ✅ Confirmed by `agent-author.md`[^5] |
| 10+ session event types | ✅ Confirmed by examples.md[^6] |
| `session.send()` / `session.sendAndWait()` | ✅ Confirmed[^5] |
| Hot reload via `/extensions reload` | ✅ Confirmed (also `extensions_reload()` tool) |
| Hook overwrite bug | ✅ References [#2076](https://github.com/github/copilot-cli/issues/2076) |
| `skipPermission` flag (v1.0.5+) | Not directly verified in SDK .d.ts |
| UI elicitation via `session.rpc.ui.elicitation()` | Plausible (types.d.ts exports `ElicitationHandler`) |

The article claims the information was "extracted from the [Copilot SDK](https://github.com/github/copilot-sdk) source itself — the `.d.ts` type definitions, internal docs, and by building extensions hands-on"[^4].

### Accuracy Assessment

The htek.dev article is **largely accurate** and aligns with what we can verify from the actual SDK files bundled with the CLI. The internal docs at `~/.copilot/pkg/universal/1.0.39/copilot-sdk/docs/` confirm the architecture, hook signatures, event types, and session API described in the article.

---

## 5. Extensions vs Plugins: Which to Use

| Use Case | Recommendation |
|----------|---------------|
| Distributable team tools | **Plugin** — marketplace support, easy install |
| Programmatic agent control | **Extension** — full SDK access |
| Custom tools with complex logic | **Extension** — handler functions |
| Sharing agents/skills across repos | **Plugin** — portable packages |
| Security guardrails (blocking commands) | **Extension** — `onPreToolUse` with `deny` |
| Auto-retry on failure | **Extension** — `onErrorOccurred` hook |
| Adding MCP/LSP servers | **Plugin** — declarative config |
| Prompt injection/rewriting | **Extension** — `modifiedPrompt` |
| Self-healing agent loops | **Extension** — `session.send()` + events |

---

## Key Repositories Summary

| Repository | Purpose | Status |
|-----------|---------|--------|
| [github/copilot-cli](https://github.com/github/copilot-cli) | CLI source, issues, discussions | Public (issues only) |
| [github/copilot-sdk](https://github.com/github/copilot-sdk) | Multi-language SDK source | Public |
| [github/copilot-plugins](https://github.com/github/copilot-plugins) | Default plugin marketplace | Public |
| [github/awesome-copilot](https://github.com/github/awesome-copilot) | Community plugin marketplace | Public |
| npm: `@github/copilot` | CLI npm package | Published |

---

## Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| Extensions system architecture | **High** | Verified from bundled SDK docs and .d.ts files on disk |
| SDK auto-resolution (not in global node_modules) | **High** | Verified by inspecting `~/.copilot/pkg/` and the absence in global `node_modules` |
| Plugin system docs and commands | **High** | Official GitHub docs, confirmed working |
| htek.dev article accuracy | **High** | Cross-referenced with bundled SDK docs; claims align |
| Hook overwrite bug | **Medium** | Cited in article, references GitHub issue, not personally reproduced |
| `skipPermission` flag | **Medium** | Mentioned in htek.dev, not found in current .d.ts (may be runtime-only) |
| UI elicitation API | **Medium** | Types exist in SDK (`ElicitationHandler`), exact API surface not fully confirmed |

### Assumptions Made

1. The user's question about "source code installed in global node modules" refers to the npm install method (`npm install -g @github/copilot`) — this places the CLI binary in global node_modules but the SDK is internal.
2. The htek.dev article is a community resource (not official GitHub documentation), but its claims are verifiable against the bundled SDK.

---

## Footnotes

[^1]: No official documentation exists on docs.github.com for the `.github/extensions/` system. The official docs only cover the Plugin system. Confirmed by searching docs.github.com and the web search results.

[^2]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\` — directory listing shows `extension.d.ts`, `extension.js`, `index.d.ts`, `index.js`, `types.d.ts`, and `docs/` subdirectory.

[^3]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\docs\extensions.md` — "The CLI scans `.github/extensions/` (project) and the user's copilot config extensions directory for subdirectories containing `extension.mjs`." Also: "The `@github/copilot-sdk` import is resolved automatically — you don't install it."

[^4]: [htek.dev/articles/github-copilot-cli-extensions-complete-guide](https://htek.dev/articles/github-copilot-cli-extensions-complete-guide) — "GitHub Copilot CLI has a full extension system... and there's essentially zero public documentation about it."

[^5]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\docs\agent-author.md` — Full hook signatures, tool registration constraints, session API methods.

[^6]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\docs\examples.md` — Complete code examples for tools, hooks, events, and multi-feature extensions.

[^7]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\extension.js` — Opens with `import __module from "module"; const require = __module.createRequire(import.meta.url);` indicating custom module resolution.

[^8]: [docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins) — "Plugins are installable packages that extend GitHub Copilot CLI with reusable agents, skills, hooks, and integrations."

[^9]: [docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) — Official guide for creating plugins.

[^10]: [docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing) — Official guide for finding and installing plugins.

[^11]: [docs.github.com/en/copilot/reference/cli-plugin-reference](https://docs.github.com/en/copilot/reference/cli-plugin-reference) — Full CLI commands, `plugin.json` schema, `marketplace.json` schema, file locations, and loading order.

[^12]: GitHub Copilot CLI README — Installation methods: npm (`npm install -g @github/copilot`), WinGet, Homebrew, install script.

[^13]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\` — Contains directories: `builtin-skills`, `clipboard`, `copilot-sdk`, `definitions`, `prebuilds`, `preloads`, `queries`, `ripgrep`, `schemas`, `sdk`, `sharp`, `worker`.

[^14]: `C:\Users\GiovanniFerrara\.copilot\pkg\universal\1.0.39\copilot-sdk\extension.js` line 1 — Uses `__module.createRequire(import.meta.url)` for module resolution.
