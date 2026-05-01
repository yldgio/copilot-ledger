import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Pure Helpers ────────────────────────────────────────────────────────────

describe("safeFileName", () => {
  it("replaces @ with underscore and appends .jsonl", async () => {
    const { safeFileName } = await import("./lib.mjs");
    expect(safeFileName("user@example.com")).toBe("user_example.com.jsonl");
  });

  it("rejects path traversal attempts", async () => {
    const { safeFileName } = await import("./lib.mjs");
    const result = safeFileName("../../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("handles empty string", async () => {
    const { safeFileName } = await import("./lib.mjs");
    const result = safeFileName("");
    expect(result).toBe("unknown.jsonl");
  });
});

describe("computeRelativeCwd", () => {
  it("returns . when cwd equals gitRoot", async () => {
    const { computeRelativeCwd } = await import("./lib.mjs");
    expect(computeRelativeCwd("/repo", "/repo")).toBe(".");
  });

  it("returns relative path with forward slashes", async () => {
    const { computeRelativeCwd } = await import("./lib.mjs");
    const result = computeRelativeCwd("/repo/src/deep", "/repo");
    expect(result).toBe("src/deep");
  });

  it("returns . when cwd is null", async () => {
    const { computeRelativeCwd } = await import("./lib.mjs");
    expect(computeRelativeCwd(null, "/repo")).toBe(".");
  });

  it("returns . when gitRoot is null", async () => {
    const { computeRelativeCwd } = await import("./lib.mjs");
    expect(computeRelativeCwd("/repo/src", null)).toBe(".");
  });
});

describe("fmtNumber", () => {
  it("formats millions", async () => {
    const { fmtNumber } = await import("./lib.mjs");
    expect(fmtNumber(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", async () => {
    const { fmtNumber } = await import("./lib.mjs");
    expect(fmtNumber(2_500)).toBe("3K");
  });

  it("returns small numbers as-is", async () => {
    const { fmtNumber } = await import("./lib.mjs");
    expect(fmtNumber(42)).toBe("42");
  });
});

describe("fmtDuration", () => {
  it("converts ms to seconds with one decimal", async () => {
    const { fmtDuration } = await import("./lib.mjs");
    expect(fmtDuration(1500)).toBe("1.5s");
    expect(fmtDuration(0)).toBe("0.0s");
  });
});

describe("flattenModelMetrics", () => {
  it("returns empty object for null/undefined input", async () => {
    const { flattenModelMetrics } = await import("./lib.mjs");
    expect(flattenModelMetrics(null)).toEqual({});
    expect(flattenModelMetrics(undefined)).toEqual({});
  });

  it("extracts all token fields from SDK format", async () => {
    const { flattenModelMetrics } = await import("./lib.mjs");
    const input = {
      "gpt-4": {
        requests: { count: 5, cost: 0.12 },
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, reasoningTokens: 50 },
      },
    };
    expect(flattenModelMetrics(input)).toEqual({
      "gpt-4": { requests: 5, cost: 0.12, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, reasoningTokens: 50 },
    });
  });

  it("defaults missing fields to 0", async () => {
    const { flattenModelMetrics } = await import("./lib.mjs");
    const input = { "claude": { requests: {}, usage: {} } };
    const result = flattenModelMetrics(input);
    expect(result["claude"].requests).toBe(0);
    expect(result["claude"].inputTokens).toBe(0);
    expect(result["claude"].reasoningTokens).toBe(0);
  });
});

describe("filterByDays", () => {
  it("filters records older than cutoff", async () => {
    const { filterByDays } = await import("./lib.mjs");
    const now = Date.now();
    const records = [
      { startTime: now - 1000 },           // 1s ago - keep
      { startTime: now - 86400000 * 10 },   // 10 days ago - keep for 30d
      { startTime: now - 86400000 * 40 },   // 40 days ago - drop for 30d
    ];
    const result = filterByDays(records, 30);
    expect(result).toHaveLength(2);
  });

  it("handles records with no startTime", async () => {
    const { filterByDays } = await import("./lib.mjs");
    const records = [{ promptCount: 1 }]; // startTime defaults to 0
    const result = filterByDays(records, 30);
    expect(result).toHaveLength(0);
  });
});

describe("aggregateRecords", () => {
  it("sums all fields across records", async () => {
    const { aggregateRecords } = await import("./lib.mjs");
    const records = [
      { promptCount: 3, premiumRequests: 2, totalApiDurationMs: 1000, codeChanges: { linesAdded: 10, linesRemoved: 5, filesModified: 2 }, modelMetrics: { "gpt-4": { requests: 1, cost: 0.1, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } },
      { promptCount: 5, premiumRequests: 3, totalApiDurationMs: 2000, codeChanges: { linesAdded: 20, linesRemoved: 10, filesModified: 3 }, modelMetrics: { "gpt-4": { requests: 2, cost: 0.2, inputTokens: 200, outputTokens: 100, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: 10 } } },
    ];
    const agg = aggregateRecords(records);
    expect(agg.sessions).toBe(2);
    expect(agg.promptCount).toBe(8);
    expect(agg.premiumRequests).toBe(5);
    expect(agg.totalApiDurationMs).toBe(3000);
    expect(agg.linesAdded).toBe(30);
    expect(agg.modelMetrics["gpt-4"].requests).toBe(3);
    expect(agg.modelMetrics["gpt-4"].reasoningTokens).toBe(10);
  });

  it("handles records with missing fields gracefully", async () => {
    const { aggregateRecords } = await import("./lib.mjs");
    const records = [{}];
    const agg = aggregateRecords(records);
    expect(agg.sessions).toBe(1);
    expect(agg.promptCount).toBe(0);
  });
});

// ─── Formatters ──────────────────────────────────────────────────────────────

describe("formatText", () => {
  it("produces readable text output", async () => {
    const { formatText } = await import("./lib.mjs");
    const agg = { sessions: 2, promptCount: 8, premiumRequests: 5, totalApiDurationMs: 3000, linesAdded: 30, linesRemoved: 15, filesModified: 5, modelMetrics: {} };
    const result = formatText("test-repo · last 30 days", agg);
    expect(result).toContain("copilot-ledger · test-repo · last 30 days");
    expect(result).toContain("Sessions:");
    expect(result).toContain("Prompts:");
    expect(result).toContain("+30 / -15 lines");
  });
});

describe("formatHtmlSummary", () => {
  it("escapes HTML entities in title and model names", async () => {
    const { formatHtmlSummary } = await import("./lib.mjs");
    const agg = { sessions: 1, promptCount: 1, premiumRequests: 1, totalApiDurationMs: 100, linesAdded: 0, linesRemoved: 0, filesModified: 0, modelMetrics: { "<script>alert(1)</script>": { requests: 1, cost: 0, inputTokens: 0, outputTokens: 0 } } };
    const result = formatHtmlSummary("<img onerror=alert(1)>", agg);
    expect(result).not.toContain("<script>alert");
    expect(result).not.toContain("<img onerror");
    expect(result).toContain("&lt;");
  });
});

describe("formatCsvSummary", () => {
  it("produces CSV with header and data row", async () => {
    const { formatCsvSummary, aggregateRecords } = await import("./lib.mjs");
    const records = [{ promptCount: 3, premiumRequests: 1, totalApiDurationMs: 500, codeChanges: { linesAdded: 5, linesRemoved: 2, filesModified: 1 }, modelMetrics: {} }];
    const result = formatCsvSummary(records, "my-repo");
    expect(result).toContain("title,sessions,promptCount");
    expect(result).toContain("my-repo,1,3,1,500,5,2,1");
  });
});

// ─── Security: Path Traversal ────────────────────────────────────────────────

describe("safeFileName security", () => {
  it("strips directory separators", async () => {
    const { safeFileName } = await import("./lib.mjs");
    expect(safeFileName("a/b\\c")).not.toMatch(/[/\\]/);
  });

  it("strips leading dots to prevent hidden files and traversal", async () => {
    const { safeFileName } = await import("./lib.mjs");
    const result = safeFileName("..hidden");
    expect(result).not.toMatch(/^\.\./);
  });
});

// ─── Orphan Recovery ─────────────────────────────────────────────────────────

describe("recoverOrphans", () => {
  it("skips pending files younger than threshold", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    // This tests the age-check fix from GPT-5.5 review
    // A pending file with lastUpdate = now should NOT be recovered
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["abc.pending.json"]),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({
        sessionId: "abc",
        repo: "test/repo",
        user: "dev@test.com",
        startTime: Date.now() - 1000,
        lastUpdate: Date.now(), // very recent — should be skipped
        promptCount: 5,
      })),
      appendFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    runtime.recoverOrphans("/fake/.ledger", "dev@test.com");
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it("recovers pending files older than threshold", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["old.pending.json"]),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({
        sessionId: "old",
        repo: "test/repo",
        user: "dev@test.com",
        startTime: Date.now() - 86400000 * 2,
        lastUpdate: Date.now() - 86400000, // 24h ago — should be recovered
        promptCount: 3,
      })),
      appendFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    runtime.recoverOrphans("/fake/.ledger", "dev@test.com");
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

// ─── Shutdown Record Builder ─────────────────────────────────────────────────

describe("buildShutdownRecord", () => {
  it("builds a v1 record from shutdown event data", async () => {
    const { buildShutdownRecord } = await import("./lib.mjs");
    const state = { sessionId: "s1", repo: "owner/repo", cwdRelative: "src", userId: "dev@test.com", sessionStartTime: 1000, promptCount: 5 };
    const data = {
      totalPremiumRequests: 3,
      totalApiDurationMs: 2000,
      shutdownType: "routine",
      currentModel: "gpt-4",
      modelMetrics: { "gpt-4": { requests: { count: 3, cost: 0.5 }, usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } },
      codeChanges: { linesAdded: 10, linesRemoved: 2, filesModified: ["a.js", "b.js"] },
    };
    const record = buildShutdownRecord(data, state);
    expect(record.v).toBe(1);
    expect(record.sessionId).toBe("s1");
    expect(record.premiumRequests).toBe(3);
    expect(record.codeChanges.filesModified).toBe(2);
    expect(record.modelMetrics["gpt-4"].requests).toBe(3);
  });

  it("handles filesModified as number", async () => {
    const { buildShutdownRecord } = await import("./lib.mjs");
    const state = { sessionId: "s1", repo: null, cwdRelative: ".", userId: "dev", sessionStartTime: 0, promptCount: 0 };
    const data = { totalPremiumRequests: 1, codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: 5 } };
    const record = buildShutdownRecord(data, state);
    expect(record.codeChanges.filesModified).toBe(5);
  });
});

// ─── readRecords ─────────────────────────────────────────────────────────────

describe("readRecords", () => {
  it("returns empty array for null dir", async () => {
    const { readRecords } = await import("./lib.mjs");
    expect(readRecords(null, {})).toEqual([]);
  });

  it("returns empty array when dir does not exist", async () => {
    const { readRecords } = await import("./lib.mjs");
    const mockFs = { existsSync: vi.fn().mockReturnValue(false) };
    expect(readRecords("/fake", mockFs)).toEqual([]);
  });

  it("parses valid JSONL lines", async () => {
    const { readRecords } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["a.jsonl"]),
      readFileSync: vi.fn().mockReturnValue('{"promptCount":1}\n{"promptCount":2}\n\n'),
    };
    const records = readRecords("/fake", mockFs);
    expect(records).toHaveLength(2);
    expect(records[0].promptCount).toBe(1);
  });

  it("skips invalid JSON lines without crashing", async () => {
    const { readRecords } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["a.jsonl"]),
      readFileSync: vi.fn().mockReturnValue('{"valid":true}\nnot-json\n'),
    };
    const records = readRecords("/fake", mockFs);
    expect(records).toHaveLength(1);
  });

  it("ignores non-jsonl files", async () => {
    const { readRecords } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["a.jsonl", "b.pending.json", "c.txt"]),
      readFileSync: vi.fn().mockReturnValue('{"x":1}\n'),
    };
    const records = readRecords("/fake", mockFs);
    expect(records).toHaveLength(1);
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
  });
});

// ─── getLedgerDir ────────────────────────────────────────────────────────────

describe("getLedgerDir", () => {
  it("returns dir path when .ledger exists", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = { existsSync: vi.fn().mockReturnValue(true) };
    const runtime = createLedgerRuntime({ fs: mockFs });
    const result = runtime.getLedgerDir("/repo");
    expect(result).toContain(".ledger");
  });

  it("returns null when .ledger does not exist", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = { existsSync: vi.fn().mockReturnValue(false) };
    const runtime = createLedgerRuntime({ fs: mockFs });
    expect(runtime.getLedgerDir("/repo")).toBeNull();
  });

  it("returns null when gitRoot is null", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const runtime = createLedgerRuntime({ fs: {} });
    expect(runtime.getLedgerDir(null)).toBeNull();
  });
});

// ─── formatHtmlTeam ──────────────────────────────────────────────────────────

describe("formatHtmlTeam", () => {
  it("produces HTML with escaped user names", async () => {
    const { formatHtmlTeam } = await import("./lib.mjs");
    const byUser = { "<script>": { sessions: 1, promptCount: 2, premiumRequests: 1, totalApiDurationMs: 500, linesAdded: 0, linesRemoved: 0, filesModified: 0, modelMetrics: {} } };
    const result = formatHtmlTeam("team", byUser);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
    expect(result).toContain("</html>");
  });
});

// ─── formatCsvTeam ───────────────────────────────────────────────────────────

describe("formatCsvTeam", () => {
  it("produces CSV rows per user", async () => {
    const { formatCsvTeam } = await import("./lib.mjs");
    const byUser = {
      "alice@dev.com": { sessions: 2, promptCount: 5, premiumRequests: 3, totalApiDurationMs: 1000, linesAdded: 10, linesRemoved: 5, filesModified: 2, modelMetrics: {} },
      "bob@dev.com": { sessions: 1, promptCount: 2, premiumRequests: 1, totalApiDurationMs: 500, linesAdded: 5, linesRemoved: 0, filesModified: 1, modelMetrics: {} },
    };
    const result = formatCsvTeam(byUser);
    expect(result).toContain("user,sessions,promptCount");
    expect(result).toContain("alice@dev.com,2,5,3,1000,10,5,2");
    expect(result).toContain("bob@dev.com,1,2,1,500,5,0,1");
  });
});

// ─── formatText with models ──────────────────────────────────────────────────

describe("formatText with model breakdown", () => {
  it("includes model lines when modelMetrics populated", async () => {
    const { formatText } = await import("./lib.mjs");
    const agg = { sessions: 1, promptCount: 1, premiumRequests: 1, totalApiDurationMs: 100, linesAdded: 0, linesRemoved: 0, filesModified: 0, modelMetrics: { "claude-sonnet": { requests: 2, cost: 0.5, inputTokens: 1500000, outputTokens: 3000 } } };
    const result = formatText("test", agg);
    expect(result).toContain("Model Breakdown:");
    expect(result).toContain("claude-sonnet");
    expect(result).toContain("1.5M");
  });
});

// ─── recoverOrphans edge cases ───────────────────────────────────────────────

describe("recoverOrphans edge cases", () => {
  it("handles corrupt pending files gracefully", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["bad.pending.json"]),
      readFileSync: vi.fn().mockReturnValue("not valid json{{{"),
      appendFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    expect(() => runtime.recoverOrphans("/fake/.ledger", "user")).not.toThrow();
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it("does nothing when dir does not exist", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = { existsSync: vi.fn().mockReturnValue(false) };
    const runtime = createLedgerRuntime({ fs: mockFs });
    runtime.recoverOrphans("/fake/.ledger", "user");
  });

  it("does nothing when no pending files", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["data.jsonl", "other.txt"]),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    runtime.recoverOrphans("/fake/.ledger", "user");
  });

  it("recovers pending files with missing fields using defaults", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(["minimal.pending.json"]),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({
        // minimal: no sessionId, no repo, no cwd, no user, no startTime, no promptCount
        lastUpdate: Date.now() - 86400000,
      })),
      appendFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    runtime.recoverOrphans("/fake/.ledger", "fallback@user.com");
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const written = JSON.parse(mockFs.appendFileSync.mock.calls[0][1].trim());
    expect(written.sessionId).toBe("minimal");
    expect(written.user).toBe("fallback@user.com");
    expect(written.cwd).toBe(".");
    expect(written.repo).toBeNull();
    expect(written.startTime).toBe(0);
    expect(written.promptCount).toBe(0);
  });

  it("handles readdirSync throwing", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockImplementation(() => { throw new Error("permission denied"); }),
    };
    const runtime = createLedgerRuntime({ fs: mockFs });
    expect(() => runtime.recoverOrphans("/fake/.ledger", "user")).not.toThrow();
  });
});

// ─── handleInit ──────────────────────────────────────────────────────────────

describe("handleInit", () => {
  it("uses provided gitRoot when available", async () => {
    const { handleInit } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    };
    const result = handleInit({ gitRoot: "/repo", detectGitRoot: vi.fn(), cwd: "/repo", fsImpl: mockFs });
    expect(result.content).toContain("✓ Initialized .ledger/");
    expect(result.ledgerDir).toContain(".ledger");
    expect(mockFs.mkdirSync).toHaveBeenCalled();
  });

  it("falls back to detectGitRoot when gitRoot is null", async () => {
    const { handleInit } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    };
    const detectGitRoot = vi.fn().mockReturnValue("/detected/repo");
    const result = handleInit({ gitRoot: null, detectGitRoot, cwd: "/detected/repo/src", fsImpl: mockFs });
    expect(detectGitRoot).toHaveBeenCalledWith("/detected/repo/src");
    expect(result.gitRoot).toBe("/detected/repo");
    expect(result.content).toContain("✓ Initialized .ledger/");
  });

  it("returns error when no git root can be found", async () => {
    const { handleInit } = await import("./lib.mjs");
    const detectGitRoot = vi.fn().mockReturnValue(null);
    const result = handleInit({ gitRoot: null, detectGitRoot, cwd: "/tmp", fsImpl: {} });
    expect(result.content).toBe("No git root detected. Cannot initialize .ledger/.");
    expect(result.gitRoot).toBeNull();
  });

  it("reports already exists when .ledger/ is present", async () => {
    const { handleInit } = await import("./lib.mjs");
    const mockFs = { existsSync: vi.fn().mockReturnValue(true) };
    const result = handleInit({ gitRoot: "/repo", detectGitRoot: vi.fn(), cwd: "/repo", fsImpl: mockFs });
    expect(result.content).toContain("already exists");
  });

  it("handles mkdir failure gracefully", async () => {
    const { handleInit } = await import("./lib.mjs");
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn().mockImplementation(() => { throw new Error("permission denied"); }),
    };
    const result = handleInit({ gitRoot: "/repo", detectGitRoot: vi.fn(), cwd: "/repo", fsImpl: mockFs });
    expect(result.content).toContain("Failed to initialize");
    expect(result.content).toContain("permission denied");
  });
});

// ─── getUserId ───────────────────────────────────────────────────────────────

describe("getUserId", () => {
  it("prefers local git email over global", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn().mockReturnValue("local@dev.com\n");
    const runtime = createLedgerRuntime({ execSync: mockExecSync });
    expect(runtime.getUserId()).toBe("local@dev.com");
    expect(mockExecSync).toHaveBeenCalledWith("git config --local user.email", expect.any(Object));
  });

  it("falls back to global when local fails", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn()
      .mockImplementationOnce(() => { throw new Error("no local"); })
      .mockReturnValueOnce("global@dev.com\n");
    const runtime = createLedgerRuntime({ execSync: mockExecSync });
    expect(runtime.getUserId()).toBe("global@dev.com");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it("falls back to os username when git fails", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn().mockImplementation(() => { throw new Error("nope"); });
    const mockOs = { userInfo: () => ({ username: "testuser" }) };
    const runtime = createLedgerRuntime({ execSync: mockExecSync, os: mockOs });
    expect(runtime.getUserId()).toBe("testuser");
  });

  it("returns unknown when everything fails", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn().mockImplementation(() => { throw new Error("nope"); });
    const mockOs = { userInfo: () => { throw new Error("no user"); } };
    const runtime = createLedgerRuntime({ execSync: mockExecSync, os: mockOs });
    expect(runtime.getUserId()).toBe("unknown");
  });

  it("returns unknown when no execSync provided", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const runtime = createLedgerRuntime({});
    expect(runtime.getUserId()).toBe("unknown");
  });
});

// ─── detectGitRoot ───────────────────────────────────────────────────────────

describe("detectGitRoot", () => {
  it("returns trimmed git root path", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn().mockReturnValue("/home/user/repo\n");
    const runtime = createLedgerRuntime({ execSync: mockExecSync });
    expect(runtime.detectGitRoot("/home/user/repo/src")).toBe("/home/user/repo");
  });

  it("returns null when not in a git repo", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const mockExecSync = vi.fn().mockImplementation(() => { throw new Error("not a git repo"); });
    const runtime = createLedgerRuntime({ execSync: mockExecSync });
    expect(runtime.detectGitRoot("/tmp")).toBeNull();
  });

  it("returns null when no execSync provided", async () => {
    const { createLedgerRuntime } = await import("./lib.mjs");
    const runtime = createLedgerRuntime({});
    expect(runtime.detectGitRoot("/tmp")).toBeNull();
  });
});
