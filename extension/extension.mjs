import { joinSession } from "@github/copilot-sdk/extension";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";
import {
  safeFileName, filterByDays,
  aggregateRecords, formatText, formatCsvSummary, formatCsvTeam,
  formatHtmlSummary, formatHtmlTeam, readRecords, buildShutdownRecord,
  buildPendingRecord, createLedgerRuntime, fmtDuration,
  handleInit, recordUserMessage, startLedgerSession,
} from "./lib.mjs";

// ─── Runtime (with real deps) ────────────────────────────────────────────────

const runtime = createLedgerRuntime({ fs, execSync, os });


// ─── State ───────────────────────────────────────────────────────────────────

const userId = runtime.getUserId();
let gitRoot = null;
let ledgerDir = null;
let usage = {
  sessionId: null,
  repo: null,
  cwdRelative: ".",
  userId,
  sessionStartTime: null,
  promptCount: 0,
  inputTokensAccum: 0,
  outputTokensAccum: 0,
  initialPrompt: null,
};


// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleLedgerInit(_args, _ctx) {
  const result = handleInit({
    gitRoot,
    detectGitRoot: (cwd) => runtime.detectGitRoot(cwd),
    cwd: process.cwd(),
    fsImpl: fs,
  });
  if (result.gitRoot) gitRoot = result.gitRoot;
  if (result.ledgerDir) ledgerDir = result.ledgerDir;
  return { content: result.content };
}

async function handleLedgerSummary(args, _ctx) {
  const days = args?.days ?? 30;
  const format = args?.format ?? "text";
  const filterRepo = args?.repo ?? null;

  const dir = ledgerDir;
  if (!dir) return { content: "No .ledger/ directory found. Run /ledger init first." };

  let records = filterByDays(readRecords(dir, fs), days);
  if (filterRepo) records = records.filter(r => r.repo === filterRepo);

  const label = `${filterRepo ?? usage.repo ?? "all repos"} · last ${days} days`;
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

  let records = filterByDays(readRecords(dir, fs), days);
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

  const records = filterByDays(readRecords(dir, fs), days);

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
    await session.log(result.content);
    return;
  }

  if (raw === "" || raw === "show") {
    const result = await handleLedgerSummary({}, context);
    await session.log(result.content);
    return;
  }

  // "show <repo> last <N> days"
  const showMatch = raw.match(/^show\s+(\S+)\s+last\s+(\d+)\s+days?$/i);
  if (showMatch) {
    const result = await handleLedgerSummary({ repo: showMatch[1], days: parseInt(showMatch[2], 10) }, context);
    await session.log(result.content);
    return;
  }

  if (/^top repos this week$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { await session.log("No .ledger/ directory. Run /ledger init first."); return; }
    const records = filterByDays(readRecords(dir, fs), 7);
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
    await session.log(out);
    return;
  }

  if (/^top users this week$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { await session.log("No .ledger/ directory. Run /ledger init first."); return; }
    const records = filterByDays(readRecords(dir, fs), 7);
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
    await session.log(out);
    return;
  }

  if (/^status$/i.test(raw)) {
    const dir = ledgerDir;
    if (!dir) { await session.log("No .ledger/ directory. Run /ledger init first."); return; }
    let fileCount = 0, recordCount = 0, pendingCount = 0;
    try {
      const files = fs.readdirSync(dir);
      fileCount = files.filter(f => f.endsWith(".jsonl")).length;
      pendingCount = files.filter(f => f.endsWith(".pending.json")).length;
      recordCount = readRecords(dir, fs).length;
    } catch (_) {}
    await session.log(`ledger dir:      ${dir}\nJSONL files:     ${fileCount}\nTotal records:   ${recordCount}\nPending files:   ${pendingCount}`);
    return;
  }

  await session.log(`Unknown /ledger subcommand: "${raw}"\nUsage: /ledger [init | show | show <repo> last <N> days | top repos this week | top users this week | status]`);
}

// ─── Session Setup ────────────────────────────────────────────────────────────

let session;

function initializeLedgerSession(data = {}) {
  const started = startLedgerSession({
    sessionId: data?.sessionId ?? session?.sessionId ?? null,
    userId,
    cwd: data?.cwd ?? process.cwd(),
    repo: data?.repository ?? null,
    initialPrompt: data?.initialPrompt ?? "",
    detectGitRoot: runtime.detectGitRoot,
    getLedgerDir: runtime.getLedgerDir,
  });
  gitRoot = started.gitRoot;
  ledgerDir = started.ledgerDir;
  usage = started.state;
}

async function recoverOrWarn() {
  if (ledgerDir) {
    runtime.recoverOrphans(ledgerDir, userId);
  } else if (gitRoot && session) {
    await session.log("[copilot-ledger] .ledger/ not found. Run /ledger init to start tracking usage.", { level: "warning" });
  }
}

session = await joinSession({
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
  hooks: {
    onSessionStart: async (data) => {
      initializeLedgerSession(data);
      await recoverOrWarn();
    },
  },
});

initializeLedgerSession({ sessionId: session.sessionId, cwd: process.cwd() });
await recoverOrWarn();

// ─── Event Handlers ───────────────────────────────────────────────────────────

session.on("user.message", (event) => {
  recordUserMessage(usage, event.data?.transformedContent ?? event.data?.content ?? "");
});

session.on("assistant.message", (event) => {
  usage.outputTokensAccum += event.data?.outputTokens ?? 0;
});

session.on("session.idle", (_event) => {
  usage.sessionId = session.sessionId ?? usage.sessionId;
  if (!ledgerDir || !usage.sessionId) return;
  const pending = buildPendingRecord(usage);
  try {
    fs.writeFileSync(path.join(ledgerDir, `${usage.sessionId}.pending.json`), JSON.stringify(pending), "utf8");
  } catch (_) {}
});

session.on("session.shutdown", (event) => {
  const data = event.data;

  // Dedup: skip if no premium activity (e.g. extension reload)
  if ((data?.totalPremiumRequests ?? 0) === 0) return;
  if (!ledgerDir) return;

  usage.sessionId = session.sessionId ?? usage.sessionId;
  const record = buildShutdownRecord(data, usage);

  try {
    const outFile = path.join(ledgerDir, safeFileName(userId));
    fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  } catch (_) {}

  // Clean up pending file
  try {
    if (usage.sessionId) {
      const pendingPath = path.join(ledgerDir, `${usage.sessionId}.pending.json`);
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
    }
  } catch (_) {}
});

await session.log('ledger extension loaded');
