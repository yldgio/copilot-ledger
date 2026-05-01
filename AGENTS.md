# Copilot Ledger

a **GitHub Copilot CLI plugin** — named `copilot-ledger` — that transparently collects Copilot usage data, attributes it to repositories, and makes it queryable by developers and team leads, without requiring any change to developer workflow.

## Behavioral guidelines

Keep the docs updated. every change to the codebase should be reflected in the documentation. If you add a new feature, update the README and any relevant docstrings. If you fix a bug, update the troubleshooting guide.

Agent install instructions live in [AUTO_INSTALL.md](AUTO_INSTALL.md). Use that file when installing the extension into the current workspace or the user extension folder.

- Plan first. Do not code until the plan is accepted.
- Use the smallest possible diff.
- No unrelated refactors or renames.
- Explain root cause before proposing a fix.
- Match existing repo patterns.
- Every behavior change requires proof.
- Always lint, build, and test before final output.
- Auth, billing, migrations, and secrets require extra review.
- Compact context at milestones.
- If there is no proof, the work is still a draft.

### 1. No Unverified Technical Claims

- Never explain how a technology, SDK, or tool works unless you have read the actual source, official documentation, or verified output that proves it.
- If you cannot cite the exact file, URL, or command output that supports your claim, say "I don't know" instead.
- Speculation presented as fact is a critical failure.
- If you need to make an assumption to proceed, state it explicitly and label it as an assumption.

### 2. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 4. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


If applicable, use RGR to complete the task.

RED: write one test
GREEN: write the implementation to pass that test
REPEAT until done
REFACTOR the code
