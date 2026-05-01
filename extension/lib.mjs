import path from "path";

// ─── Constants ───────────────────────────────────────────────────────────────

const ORPHAN_AGE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ─── Pure Helpers ────────────────────────────────────────────────────────────

export function safeFileName(user) {
  if (!user || user.trim() === "") return "unknown.jsonl";
  let safe = user.replace(/@/g, "_");
  safe = safe.replace(/[/\\]/g, "_");
  safe = safe.replace(/\.\./g, "_");
  safe = safe.replace(/^\.+/, "");
  if (!safe || safe.trim() === "") return "unknown.jsonl";
  return safe + ".jsonl";
}

export function computeRelativeCwd(cwd, gitRoot) {
  if (!cwd || !gitRoot) return ".";
  const rel = path.relative(gitRoot, cwd).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}

export function fmtNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

export function fmtDuration(ms) {
  return (ms / 1000).toFixed(1) + "s";
}

export function flattenModelMetrics(sdkMetrics) {
  if (!sdkMetrics) return {};
  const result = {};
  for (const [model, data] of Object.entries(sdkMetrics)) {
    result[model] = {
      requests: data?.requests?.count ?? 0,
      cost: data?.requests?.cost ?? 0,
      inputTokens: data?.usage?.inputTokens ?? 0,
      outputTokens: data?.usage?.outputTokens ?? 0,
      cacheReadTokens: data?.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: data?.usage?.cacheWriteTokens ?? 0,
      reasoningTokens: data?.usage?.reasoningTokens ?? 0,
    };
  }
  return result;
}

export function filterByDays(records, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter(r => (r.startTime ?? 0) >= cutoff);
}

export function aggregateRecords(records) {
  const agg = {
    sessions: records.length,
    promptCount: 0,
    premiumRequests: 0,
    totalApiDurationMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesModified: 0,
    modelMetrics: {},
  };
  for (const r of records) {
    agg.promptCount += r.promptCount ?? 0;
    agg.premiumRequests += r.premiumRequests ?? 0;
    agg.totalApiDurationMs += r.totalApiDurationMs ?? 0;
    agg.linesAdded += r.codeChanges?.linesAdded ?? 0;
    agg.linesRemoved += r.codeChanges?.linesRemoved ?? 0;
    agg.filesModified += r.codeChanges?.filesModified ?? 0;
    for (const [model, m] of Object.entries(r.modelMetrics ?? {})) {
      if (!agg.modelMetrics[model]) {
        agg.modelMetrics[model] = { requests: 0, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
      }
      agg.modelMetrics[model].requests += m.requests ?? 0;
      agg.modelMetrics[model].cost += m.cost ?? 0;
      agg.modelMetrics[model].inputTokens += m.inputTokens ?? 0;
      agg.modelMetrics[model].outputTokens += m.outputTokens ?? 0;
      agg.modelMetrics[model].cacheReadTokens += m.cacheReadTokens ?? 0;
      agg.modelMetrics[model].cacheWriteTokens += m.cacheWriteTokens ?? 0;
      agg.modelMetrics[model].reasoningTokens += m.reasoningTokens ?? 0;
    }
  }
  return agg;
}

// ─── HTML Escaping ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatText(title, agg) {
  const header = `copilot-ledger · ${title}`;
  const sep = "─".repeat(header.length);
  let out = `${header}\n${sep}\n`;
  out += `Sessions:           ${agg.sessions}\n`;
  out += `Prompts:            ${agg.promptCount}\n`;
  out += `Premium Requests:   ${agg.premiumRequests}\n`;
  out += `API Duration:       ${fmtDuration(agg.totalApiDurationMs)}\n`;

  const models = Object.entries(agg.modelMetrics);
  if (models.length > 0) {
    out += `\nModel Breakdown:\n`;
    for (const [model, m] of models) {
      out += `  ${model.padEnd(24)} requests: ${String(m.requests).padEnd(5)} cost: ${String(m.cost).padEnd(5)} in: ${fmtNumber(m.inputTokens).padEnd(7)} out: ${fmtNumber(m.outputTokens)}\n`;
    }
  }

  out += `\nCode Changes:\n`;
  out += `  +${agg.linesAdded} / -${agg.linesRemoved} lines · ${agg.filesModified} files modified\n`;
  return out;
}

export function formatCsvSummary(records, title) {
  const agg = aggregateRecords(records);
  const header = "title,sessions,promptCount,premiumRequests,totalApiDurationMs,linesAdded,linesRemoved,filesModified";
  const row = [title, agg.sessions, agg.promptCount, agg.premiumRequests, agg.totalApiDurationMs, agg.linesAdded, agg.linesRemoved, agg.filesModified].join(",");
  return header + "\n" + row + "\n";
}

export function formatCsvTeam(byUser) {
  const header = "user,sessions,promptCount,premiumRequests,totalApiDurationMs,linesAdded,linesRemoved,filesModified";
  const rows = Object.entries(byUser).map(([user, agg]) =>
    [user, agg.sessions, agg.promptCount, agg.premiumRequests, agg.totalApiDurationMs, agg.linesAdded, agg.linesRemoved, agg.filesModified].join(",")
  );
  return header + "\n" + rows.join("\n") + "\n";
}

export function formatHtmlSummary(title, agg) {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>copilot-ledger · ${safeTitle}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.2rem; border-bottom: 2px solid #0969da; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border: 1px solid #d0d7de; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
<h1>copilot-ledger · ${safeTitle}</h1>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Sessions</td><td>${agg.sessions}</td></tr>
  <tr><td>Prompts</td><td>${agg.promptCount}</td></tr>
  <tr><td>Premium Requests</td><td>${agg.premiumRequests}</td></tr>
  <tr><td>API Duration</td><td>${fmtDuration(agg.totalApiDurationMs)}</td></tr>
  <tr><td>Lines Added</td><td>+${agg.linesAdded}</td></tr>
  <tr><td>Lines Removed</td><td>-${agg.linesRemoved}</td></tr>
  <tr><td>Files Modified</td><td>${agg.filesModified}</td></tr>
</table>
${Object.keys(agg.modelMetrics).length > 0 ? `
<h2>Model Breakdown</h2>
<table>
  <tr><th>Model</th><th>Requests</th><th>Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr>
  ${Object.entries(agg.modelMetrics).map(([m, v]) =>
    `<tr><td>${escapeHtml(m)}</td><td>${v.requests}</td><td>${v.cost}</td><td>${fmtNumber(v.inputTokens)}</td><td>${fmtNumber(v.outputTokens)}</td></tr>`
  ).join("\n  ")}
</table>` : ""}
</body></html>`;
}

export function formatHtmlTeam(title, byUser) {
  const safeTitle = escapeHtml(title);
  const rows = Object.entries(byUser).map(([user, agg]) =>
    `<tr><td>${escapeHtml(user)}</td><td>${agg.sessions}</td><td>${agg.promptCount}</td><td>${agg.premiumRequests}</td><td>${fmtDuration(agg.totalApiDurationMs)}</td></tr>`
  ).join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>copilot-ledger · ${safeTitle}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.2rem; border-bottom: 2px solid #0969da; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border: 1px solid #d0d7de; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
<h1>copilot-ledger · ${safeTitle}</h1>
<table>
  <tr><th>User</th><th>Sessions</th><th>Prompts</th><th>Premium Requests</th><th>API Duration</th></tr>
  ${rows}
</table>
</body></html>`;
}

// ─── Shutdown Record Builder ─────────────────────────────────────────────────

export function buildShutdownRecord(data, state) {
  const flatMetrics = flattenModelMetrics(data?.modelMetrics);
  return {
    v: 1,
    sessionId: state.sessionId,
    repo: state.repo,
    cwd: state.cwdRelative,
    user: state.userId,
    startTime: data?.sessionStartTime ?? state.sessionStartTime,
    endTime: Date.now(),
    shutdownType: data?.shutdownType ?? "routine",
    promptCount: state.promptCount,
    premiumRequests: data?.totalPremiumRequests ?? 0,
    totalApiDurationMs: data?.totalApiDurationMs ?? 0,
    currentModel: data?.currentModel ?? null,
    modelMetrics: flatMetrics,
    codeChanges: {
      linesAdded: data?.codeChanges?.linesAdded ?? 0,
      linesRemoved: data?.codeChanges?.linesRemoved ?? 0,
      filesModified: Array.isArray(data?.codeChanges?.filesModified)
        ? data.codeChanges.filesModified.length
        : (data?.codeChanges?.filesModified ?? 0),
    },
  };
}

// ─── JSONL I/O ───────────────────────────────────────────────────────────────

export function readRecords(dir, fsImpl) {
  const fs = fsImpl;
  const records = [];
  if (!dir || !fs || !fs.existsSync(dir)) return records;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    for (const file of files) {
      try {
        const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { records.push(JSON.parse(trimmed)); } catch (_) {}
        }
      } catch (_) {}
    }
  } catch (_) {}
  return records;
}

// ─── Runtime Factory (injectable deps for testability) ───────────────────────

export function createLedgerRuntime(deps = {}) {
  const fsImpl = deps.fs || null;
  const execSyncImpl = deps.execSync || null;
  const osImpl = deps.os || null;

  function getUserId() {
    const exec = execSyncImpl;
    if (!exec) return "unknown";
    try { return exec("git config --local user.email", { encoding: "utf8" }).trim(); } catch (_) {}
    try { return exec("git config --global user.email", { encoding: "utf8" }).trim(); } catch (_) {}
    try { return (osImpl || { userInfo: () => ({ username: "unknown" }) }).userInfo().username; } catch (_) {}
    return "unknown";
  }

  function detectGitRoot(cwd) {
    const exec = execSyncImpl;
    if (!exec) return null;
    try {
      return exec("git rev-parse --show-toplevel", { encoding: "utf8", cwd: cwd || undefined }).trim();
    } catch (_) { return null; }
  }

  function getLedgerDir(gitRoot) {
    const fs = fsImpl;
    if (!fs || !gitRoot) return null;
    const dir = path.join(gitRoot, ".ledger");
    return fs.existsSync(dir) ? dir : null;
  }

  function recoverOrphans(dir, userId) {
    const fs = fsImpl;
    if (!fs || !dir || !fs.existsSync(dir)) return;
    let pending;
    try { pending = fs.readdirSync(dir).filter(f => f.endsWith(".pending.json")); }
    catch (_) { return; }

    for (const file of pending) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw);

        // Skip files younger than threshold (likely still active)
        const lastUpdate = data.lastUpdate ?? data.startTime ?? 0;
        if (Date.now() - lastUpdate < ORPHAN_AGE_THRESHOLD_MS) continue;

        const record = {
          v: 1,
          sessionId: data.sessionId ?? file.replace(".pending.json", ""),
          repo: data.repo ?? null,
          cwd: data.cwd ?? ".",
          user: data.user ?? userId,
          startTime: data.startTime ?? 0,
          endTime: lastUpdate,
          shutdownType: "recovered",
          promptCount: data.promptCount ?? 0,
          premiumRequests: 0,
          totalApiDurationMs: 0,
          currentModel: null,
          modelMetrics: {},
          codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: 0 },
        };
        const outFile = path.join(dir, safeFileName(record.user));
        fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
        fs.unlinkSync(filePath);
      } catch (_) {
        // Don't crash on bad pending files
      }
    }
  }

  return { getUserId, detectGitRoot, getLedgerDir, recoverOrphans };
}
