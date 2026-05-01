# ~~Compute tok_est from initialPrompt on session_start events~~

> **Status:** Superseded by ADR-0002. The extension-based collection approach provides exact token counts from `session.shutdown` events, eliminating the need for tok_est heuristics and prompt_hash deduplication.

---

*Original decision (retained for history):*

The `sessionStart` hook payload includes an `initialPrompt` field containing the user's first prompt text. It is unclear whether `userPromptSubmitted` also fires for this same initial prompt — the docs don't guarantee it. To avoid silently losing tok_est for the first interaction of every session, we compute `tok_est` from `initialPrompt` in `session-start.sh` and store it on the `session_start` event.

Both `session_start` and `prompt` events include a `prompt_hash` field (first 8 hex chars of SHA-256 of the raw prompt text). The MCP server deduplicates: if a `prompt` event has the same `prompt_hash` as the immediately preceding `session_start` for the same user/repo, the `prompt` event is dropped during indexing.

## Considered Options

- **Trust that `userPromptSubmitted` always fires for the initial prompt** — simpler, but if wrong, we silently undercount every session by one prompt. Undetectable data loss.
- **Deduplicate by timestamp proximity** — fragile; legitimate fast prompts could be collapsed. Requires a magic threshold.
- **Compute tok_est in session-start.sh + hash-based dedup (chosen)** — belt-and-suspenders. The hash is deterministic and exact: same prompt text = same hash, no heuristics. Worst case is a duplicate that's trivially deduplicated. Best case prevents a systematic gap.
