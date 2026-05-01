import { joinSession } from "@github/copilot-sdk/extension";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getUserId() {
  try { return execSync("git config --global user.email", { encoding: "utf8" }).trim(); } catch (_) {}
  try { return execSync("git config user.email", { encoding: "utf8" }).trim(); } catch (_) {}
  try { return os.userInfo().username; } catch (_) {}
  return "unknown";
}

function safeFileName(user) {
  return user.replace(/@/g, "_") + ".jsonl";
}

function getLedgerDir(gitRoot) {
  if (!gitRoot) return null;
  const dir = path.join(gitRoot, ".ledger");
  return fs.existsSync(dir) ? dir : null;
}

function computeRelativeCwd(cwd, gitRoot) {
  if (!cwd || !gitRoot) return ".";
  const rel = path.relative(gitRoot, cwd).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}

function flattenModelMetrics(sdkMetrics) {
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

function recoverOrphans(dir, userId) {
  if (!dir || !fs.existsSync(dir)) return;
  let pending;
  try { pending = fs.readdirSync(dir).filter(f => f.endsWith(".pending.json")); }
  catch (_) { return; }

  for (const file of pending) {
    const filePath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      const record = {
        v: 1,
        sessionId: data.sessionId ?? file.replace(".pending.json", ""),
        repo: data.repo ?? null,
        cwd: data.cwd ?? ".",
        user: data.user ?? userId,
        startTime: data.startTime ?? 0,
        endTime: data.lastUpdate ?? data.startTime ?? 0,
        shutdownType: "recovered",
        promptCount: data.promptCount ?? 0,
        premiumRequests: 0,
        totalApiDurationMs: 0,
        currentModel: data.currentModel ?? null,
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

// ─── State ───────────────────────────────────────────────────────────────────

const userId = getUserId();
let sessionId = null;
let repo = null;
let gitRoot = null;
let cwdRelative = ".";
let ledgerDir = null;
let promptCount = 0;
let outputTokensAccum = 0;
let sessionStartTime = null;

// ─── JSONL I/O ───────────────────────────────────────────────────────────────

function readRecords(dir) {
  const records = [];
  if (!dir || !fs.existsSync(dir)) return records;
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

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function fmtDuration(ms) {
  return (ms / 1000).toFixed(1) + "s";
}

function aggregateRecords(records) {
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

function formatText(title, agg) {
  const sep = "─".repeat(("copilot-ledger · " + title).length);
  let out = `copilot-ledger · ${title}\n${sep}\n`;
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

function formatCsvSummary(records, title) {
  const agg = aggregateRecords(records);
  const header = "title,sessions,promptCount,premiumRequests,totalApiDurationMs,linesAdded,linesRemoved,filesModified";
  const row = [title, agg.sessions, agg.promptCount, agg.premiumRequests, agg.totalApiDurationMs, agg.linesAdded, agg.linesRemoved, agg.filesModified].join(",");
  return header + "\n" + row + "\n";
}

function formatCsvTeam(byUser) {
  const header = "user,sessions,promptCount,premiumRequests,totalApiDurationMs,linesAdded,linesRemoved,filesModified";
  const rows = Object.entries(byUser).map(([user, agg]) =>
    [user, agg.sessions, agg.promptCount, agg.premiumRequests, agg.totalApiDurationMs, agg.linesAdded, agg.linesRemoved, agg.filesModified].join(",")
  );
  return header + "\n" + rows.join("\n") + "\n";
}

function formatHtmlSummary(title, agg) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>copilot-ledger · ${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.2rem; border-bottom: 2px solid #0969da; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border: 1px solid #d0d7de; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
<h1>copilot-ledger · ${title}</h1>
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
    `<tr><td>${m}</td><td>${v.requests}</td><td>${v.cost}</td><td>${fmtNumber(v.inputTokens)}</td><td>${fmtNumber(v.outputTokens)}</td></tr>`
  ).join("\n  ")}
</table>` : ""}
</body></html>`;
}

function formatHtmlTeam(title, byUser) {
  const rows = Object.entries(byUser).map(([user, agg]) =>
    `<tr><td>${user}</td><td>${agg.sessions}</td><td>${agg.promptCount}</td><td>${agg.premiumRequests}</td><td>${fmtDuration(agg.totalApiDurationMs)}</td></tr>`
  ).join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>copilot-ledger · ${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.2rem; border-bottom: 2px solid #0969da; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border: 1px solid #d0d7de; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
<h1>copilot-ledger · ${title}</h1>
<table>
  <tr><th>User</th><th>Sessions</th><th>Prompts</th><th>Premium Requests</th><th>API Duration</th></tr>
  ${rows}
</table>
</body></html>`;
}

function filterByDays(records, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter(r => (r.startTime ?? 0) >= cutoff);
}

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleLedgerInit(_args, _ctx) {
  if (!gitRoot) return { content: "No git root detected. Cannot initialize .ledger/." };
  const dir = path.join(gitRoot, ".ledger");
  const alreadyExisted = fs.existsSync(dir);
  try {
    if (!alreadyExisted) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".gitignore"), "*.pending.json\n", "utf8");
    }
    ledgerDir = dir;
    return { content: alreadyExisted ? `.ledger/ already exists at ${dir}` : `✓ Initialized .ledger/ at ${dir}\n  Added .gitignore to exclude pending files.` };
  } catch (err) {
    return { content: `Failed to initialize .ledger/: ${err.message}` };
  }
}

async function handleLedgerSummary(args, _ctx) {
  const days = args?.days ?? 30;
  const format = args?.format ?? "text";
  const filterRepo = args?.repo ?? null;

  const dir = ledgerDir;
  if (!dir) return { content: "No .ledger/ directory found. Run /ledger init first." };

  let records = filterByDays(readRecords(dir), days);
  if (filterRepo) records = records.filter(r => r.repo === filterRepo);

  const label = `${filterRepo ?? repo ?? "all repos"} · last ${days} days`;
  const agg = aggregateRecords(records);

  if (format === "csv") return { content: formatCsvSummary(records, label) };
  if (format === "html") return { content: formatHtmlSummary(label, agg) };
  return { content: formatText(label, agg) };
}

async function handleLedgerUser(args, _ctx) {
  const targetUser = args?.user ?? userId;
  const days = args?.days ?? 30;
  const format = args?.format ?? "text";

  const dir = ledgerDir;
  if (!dir) return { content: "No .ledger/ directory found. Run /ledger init first." };

  let records = filterByDays(readRecords(dir), days);
  records = records.filter(r => r.user === targetUser);

  const label = `${targetUser} · last ${days} days`;
  const agg = aggregateRecords(records);

  if (format === "csv") return { content: formatCsvSummary(records, label) };
  if (format === "html") return { content: formatHtmlSummary(label, agg) };
  return { content: formatText(label, agg) };
}

async function handleLedgerTeam(args, _ctx) {
  const days = args?.days ?? 30;
  const format = args?.format ?? "text";

  const dir = ledgerDir;
  if (!dir) return { content: "No .ledger/ directory found. Run /ledger init first." };

  const records = filterByDays(readRecords(dir), days);

  const byUser = {};
  for (const r of records) {
    const u = r.user ?? "unknown";
    if (!byUser[u]) byUser[u] = [];
    byUser[u].push(r);
  }
  const aggByUser = {};
  for (const [u, recs] of Object.entries(byUser)) {
    aggByUser[u] = aggregateRecords(recs);
  }

  const label = `team · last ${days} days`;
  if (format === "csv") return { content: formatCsvTeam(aggByUser) };
  if (format === "html") return { content: formatHtmlTeam(label, aggByUser) };

  let out = `copilot-ledger · ${label}\n${"─".repeat((`copilot-ledger · ${label}`).length)}\n`;
  for (const [u, agg] of Object.entries(aggByUser)) {
    out += `\n${u}\n  Sessions: ${agg.sessions}  Prompts: ${agg.promptCount}  Premium: ${agg.premiumRequests}  Duration: ${fmtDuration(agg.totalApiDurationMs)}\n`;
  }
  return { content: out };
}

// ─── /ledger Command ─────────────────────────────────────────────────────────

async function handleLedgerCommand(context) {
  const raw = (context.args ?? "").trim();

  if (raw === "init") {
    const result = await handleLedgerInit({}, context);
    process.stdout.write(result.content + "\n");
    return;
  }

  if (raw === "" || raw === "show") {
    const result = await handleLedgerSummary({}, context);
    process.stdout.write(result.content + "\n");
    return;
  }

  // "show <repo> last <N> days"
  const showMatch = raw.match(/^show\s+(\S+)\s+last\s+(\d+)\s+days?$/i);
  if (showMatch) {
    const result = await handleLedgerSummary({ repo: showMatch[1], days: parseInt(showMatch[2], 10) }, context);
    process.stdout.write(result.content + "\n");
    return;
  }

  if (/^top repos this week$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { process.stdout.write("No .ledger/ directory. Run /ledger init first.\n"); return; }
    const records = filterByDays(readRecords(dir), 7);
    const byRepo = {};
    for (const r of records) {
      const k = r.repo ?? "(unknown)";
      if (!byRepo[k]) byRepo[k] = { sessions: 0, premiumRequests: 0 };
      byRepo[k].sessions++;
      byRepo[k].premiumRequests += r.premiumRequests ?? 0;
    }
    const sorted = Object.entries(byRepo).sort((a, b) => b[1].premiumRequests - a[1].premiumRequests);
    let out = "Top repos this week (by premium requests):\n";
    for (const [r, v] of sorted) {
      out += `  ${r.padEnd(40)} sessions: ${v.sessions}  premium: ${v.premiumRequests}\n`;
    }
    process.stdout.write(out + "\n");
    return;
  }

  if (/^top users this week$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { process.stdout.write("No .ledger/ directory. Run /ledger init first.\n"); return; }
    const records = filterByDays(readRecords(dir), 7);
    const byUser = {};
    for (const r of records) {
      const u = r.user ?? "unknown";
      if (!byUser[u]) byUser[u] = { sessions: 0, premiumRequests: 0 };
      byUser[u].sessions++;
      byUser[u].premiumRequests += r.premiumRequests ?? 0;
    }
    const sorted = Object.entries(byUser).sort((a, b) => b[1].premiumRequests - a[1].premiumRequests);
    let out = "Top users this week (by premium requests):\n";
    for (const [u, v] of sorted) {
      out += `  ${u.padEnd(40)} sessions: ${v.sessions}  premium: ${v.premiumRequests}\n`;
    }
    process.stdout.write(out + "\n");
    return;
  }

  if (/^status$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { process.stdout.write("No .ledger/ directory. Run /ledger init first.\n"); return; }
    let fileCount = 0, recordCount = 0, pendingCount = 0;
    try {
      const files = fs.readdirSync(dir);
      fileCount = files.filter(f => f.endsWith(".jsonl")).length;
      pendingCount = files.filter(f => f.endsWith(".pending.json")).length;
      recordCount = readRecords(dir).length;
    } catch (_) {}
    process.stdout.write(`ledger dir:      ${dir}\nJSONL files:     ${fileCount}\nTotal records:   ${recordCount}\nPending files:   ${pendingCount}\n`);
    return;
  }

  process.stdout.write(`Unknown /ledger subcommand: "${raw}"\nUsage: /ledger [init | show | show <repo> last <N> days | top repos this week | top users this week | status]\n`);
}

// ─── Session Setup ────────────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "ledger-init",
      description: "Initialize the .ledger/ directory in the current git repository to start tracking Copilot usage. Creates .gitignore for pending files.",
      skipPermission: true,
      handler: handleLedgerInit,
    },
    {
      name: "ledger-summary",
      description: "Summarize Copilot usage for a repository over a time window.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format. Defaults to current repo." },
          days: { type: "number", description: "Number of days to look back. Default 30." },
          format: { type: "string", enum: ["text", "csv", "html"], description: "Output format. Default text." },
        },
      },
      skipPermission: true,
      handler: handleLedgerSummary,
    },
    {
      name: "ledger-user",
      description: "Show Copilot usage for a specific user.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "User email or username. Defaults to current user." },
          days: { type: "number", description: "Number of days to look back. Default 30." },
          format: { type: "string", enum: ["text", "csv", "html"], description: "Output format. Default text." },
        },
      },
      skipPermission: true,
      handler: handleLedgerUser,
    },
    {
      name: "ledger-team",
      description: "Show Copilot usage grouped by user for the whole team.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days to look back. Default 30." },
          format: { type: "string", enum: ["text", "csv", "html"], description: "Output format. Default text." },
        },
      },
      skipPermission: true,
      handler: handleLedgerTeam,
    },
  ],
  commands: [
    {
      name: "ledger",
      description: "Query Copilot usage. Subcommands: init, show, top repos this week, top users this week, status.",
      handler: handleLedgerCommand,
    },
  ],
});

// ─── Event Handlers ───────────────────────────────────────────────────────────

session.on("session.start", (event) => {
  const data = event.data;
  sessionId = data.sessionId;
  repo = data.context?.repository ?? null;
  gitRoot = data.context?.gitRoot ?? null;
  const cwd = data.context?.cwd ?? null;
  cwdRelative = computeRelativeCwd(cwd, gitRoot);
  sessionStartTime = Date.now();
  promptCount = 0;
  outputTokensAccum = 0;

  ledgerDir = getLedgerDir(gitRoot);

  if (ledgerDir) {
    recoverOrphans(ledgerDir, userId);
  } else if (gitRoot) {
    process.stderr.write(
      "[copilot-ledger] .ledger/ not found. Run /ledger init to start tracking usage.\n"
    );
  }
});

session.on("user.message", (_event) => {
  promptCount++;
});

session.on("assistant.message", (event) => {
  const data = event.data;
  outputTokensAccum += data?.outputTokens ?? data?.tokenCount ?? 0;
});

session.on("session.idle", (_event) => {
  if (!ledgerDir || !sessionId) return;
  const pending = {
    sessionId,
    repo,
    cwd: cwdRelative,
    user: userId,
    startTime: sessionStartTime,
    lastUpdate: Date.now(),
    promptCount,
  };
  try {
    fs.writeFileSync(path.join(ledgerDir, `${sessionId}.pending.json`), JSON.stringify(pending), "utf8");
  } catch (_) {}
});

session.on("session.shutdown", (event) => {
  const data = event.data;

  // Dedup: skip if no premium activity (e.g. extension reload)
  if ((data?.totalPremiumRequests ?? 0) === 0) return;
  if (!ledgerDir) return;

  const flatMetrics = flattenModelMetrics(data?.modelMetrics);

  const record = {
    v: 1,
    sessionId,
    repo,
    cwd: cwdRelative,
    user: userId,
    startTime: data?.sessionStartTime ?? sessionStartTime,
    endTime: Date.now(),
    shutdownType: data?.shutdownType ?? "routine",
    promptCount,
    premiumRequests: data?.totalPremiumRequests ?? 0,
    totalApiDurationMs: data?.totalApiDurationMs ?? 0,
    currentModel: data?.currentModel ?? null,
    modelMetrics: flatMetrics,
    codeChanges: {
      linesAdded: data?.codeChanges?.linesAdded ?? 0,
      linesRemoved: data?.codeChanges?.linesRemoved ?? 0,
      filesModified: data?.codeChanges?.filesModified?.length ?? 0,
    },
  };

  try {
    const outFile = path.join(ledgerDir, safeFileName(userId));
    fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  } catch (_) {}

  // Clean up pending file
  try {
    if (sessionId) {
      const pendingPath = path.join(ledgerDir, `${sessionId}.pending.json`);
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
    }
  } catch (_) {}
});
