# Extension-based collection instead of plugin hooks

We chose to implement data collection via the Copilot CLI Extensions system (`~/.copilot/extensions/`) instead of plugin-level hooks (`hooks.json`). Extensions provide a programmatic event streaming API (`session.on()`) with access to `session.shutdown`, `session.model_change`, and `user.message` events that expose exact token counts, model identifiers, session IDs, and pre-parsed repository identity — none of which are available in hook payloads.

This eliminates the need for tok_est heuristics, prompt_hash dedup, manual git-remote parsing, and session reconstruction logic. The trade-off is that extensions have no official public documentation (the SDK is bundled internally at `~/.copilot/pkg/`) and cannot be distributed via `copilot plugin install`. Installation is via copy to `~/.copilot/extensions/` (user-scoped, all repos) or `.github/extensions/` (project-scoped).

## Considered Options

- **Plugin-level hooks (rejected)** — officially documented and distributable via marketplace, but hook payloads lack token counts, model info, and session IDs. Compensating for these gaps required multiple heuristics (tok_est, prompt_hash, sed-based repo parsing, session reconstruction) that added complexity and reduced data accuracy.
- **Extensions with `session.on()` events (chosen)** — undocumented but the SDK `.d.ts` types are well-defined and versioned. The `ShutdownData` type provides exact per-model token breakdowns (`inputTokens`, `outputTokens`, `reasoningTokens`, `cacheReadTokens`), `totalPremiumRequests`, cost multipliers, and `repository` already parsed. Data quality is dramatically better with simpler code.

## Consequences

- Distribution changes from `copilot plugin install` to a setup script or manual copy.
- **Workspace extensions (`.github/extensions/`) only work inside git repositories.** User-scoped extensions (`~/.copilot/extensions/`) work everywhere. For always-on collection, install to user scope.
- The hook overwrite bug ([github/copilot-cli#2076](https://github.com/github/copilot-cli/issues/2076)) was reported for extensions registering hooks; our approach uses events (`session.on()`), not hooks. Bug status unverified — may already be fixed.
- The plugin is still needed for the `/ledger` skill and potentially for MCP/CLI tooling. The extension handles collection only.
- Shutdown events with `totalPremiumRequests: 0` must be ignored — they fire when the extension reloads into an existing session with zeroed metrics.
