import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fixture from "./fixtures/claude-usage.json";
import {
  normalizeClaudeUsage,
  pickFreshestCreds,
  persistLastGood,
  loadLastGoodFromDisk,
  orderRefreshTokens,
  applyStaleFallback,
} from "../claude";

describe("normalizeClaudeUsage", () => {
  it("returns two windows labelled '5h' and 'weekly'", () => {
    const result = normalizeClaudeUsage(fixture);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows.map((w) => w.label)).toEqual(["5h", "weekly"]);
    expect(result.windows.map((w) => w.windowSecs)).toEqual([18000, 604800]);
    for (const w of result.windows) {
      expect(w.usedPercent).toBeGreaterThanOrEqual(0);
      expect(w.usedPercent).toBeLessThanOrEqual(100);
      expect(w.resetAt).toBeGreaterThan(0);
    }
  });

  it("returns ok:false on unrecognized shape", () => {
    const result = normalizeClaudeUsage({ totally: "different" });
    expect(result.ok).toBe(false);
  });

  it("accepts unused windows without a scheduled reset", () => {
    expect(normalizeClaudeUsage({
      five_hour: { utilization: 0, resets_at: null },
      seven_day: { utilization: 0, resets_at: null },
    })).toEqual({
      ok: true,
      windows: [
        { label: "5h", usedPercent: 0, windowSecs: 18000 },
        { label: "weekly", usedPercent: 0, windowSecs: 604800 },
      ],
    });
  });
});

describe("pickFreshestCreds", () => {
  const a = { accessToken: "a", refreshToken: "ra", expiresAt: 1000 };
  const b = { accessToken: "b", refreshToken: "rb", expiresAt: 2000 };

  it("returns null when all candidates are null", () => {
    expect(pickFreshestCreds([null, null])).toBe(null);
  });

  it("picks the credential with the latest expiresAt", () => {
    expect(pickFreshestCreds([a, b])).toBe(b);
    expect(pickFreshestCreds([b, a])).toBe(b);
  });

  it("ignores nulls among valid candidates", () => {
    expect(pickFreshestCreds([null, a, null])).toBe(a);
  });
});

describe("orderRefreshTokens", () => {
  const mem = { accessToken: "am", refreshToken: "rm", expiresAt: 2000 };
  const stored = { accessToken: "as", refreshToken: "rs", expiresAt: 1000 };

  it("tries the fresher credential's refresh token first", () => {
    expect(orderRefreshTokens(mem, stored)).toEqual(["rm", "rs"]);
  });

  it("prefers the stored token when it is fresher than memory", () => {
    expect(orderRefreshTokens({ ...mem, expiresAt: 500 }, stored)).toEqual(["rs", "rm"]);
  });

  it("dedupes identical refresh tokens", () => {
    expect(orderRefreshTokens({ ...mem, refreshToken: "rs" }, stored)).toEqual(["rs"]);
  });

  it("handles a missing in-memory token", () => {
    expect(orderRefreshTokens(null, stored)).toEqual(["rs"]);
  });
});

describe("applyStaleFallback", () => {
  const nowMs = 1_700_000_000_000;
  const lastGood = {
    atMs: nowMs - 3 * 3600_000, // 3h old — within the stale window
    windows: [{ label: "weekly", usedPercent: 24, resetAt: 1_700_010_000, windowSecs: 604800 }],
  };
  const failed = {
    result: { ok: false as const, error: "token refresh HTTP 400 (invalid_grant)" },
    ttl: 300_000,
  };

  it("serves the recent snapshot with the failure reason attached", () => {
    const out = applyStaleFallback(failed, lastGood, nowMs);
    expect(out.ttl).toBe(300_000);
    expect(out.result).toEqual({
      ok: true,
      windows: lastGood.windows,
      snapshotAt: Math.floor(lastGood.atMs / 1000),
      staleReason: "token refresh HTTP 400 (invalid_grant)",
    });
  });

  it("returns the failure unchanged when the snapshot is too old", () => {
    const ancient = { ...lastGood, atMs: nowMs - 8 * 24 * 3600_000 };
    expect(applyStaleFallback(failed, ancient, nowMs)).toBe(failed);
  });

  it("returns the failure unchanged when there is no snapshot", () => {
    expect(applyStaleFallback(failed, null, nowMs)).toBe(failed);
  });

  it("passes successful results through untouched", () => {
    const okRes = { result: { ok: true as const, windows: lastGood.windows }, ttl: 90_000 };
    expect(applyStaleFallback(okRes, lastGood, nowMs)).toBe(okRes);
  });
});

describe("last-good disk cache", () => {
  const file = path.join(os.tmpdir(), `life-dashboard-test-${process.pid}.json`);
  const lg = {
    atMs: 1_700_000_000_000,
    windows: [{ label: "5h", usedPercent: 42, resetAt: 1_700_000_900 }],
  };

  it("round-trips a snapshot through disk", () => {
    persistLastGood(lg, file);
    expect(loadLastGoodFromDisk(file)).toEqual(lg);
    fs.rmSync(file, { force: true });
  });

  it("round-trips a snapshot without a scheduled reset", () => {
    const withoutReset = {
      atMs: lg.atMs,
      windows: [{ label: "5h", usedPercent: 0, windowSecs: 18000 }],
    };
    persistLastGood(withoutReset, file);
    expect(loadLastGoodFromDisk(file)).toEqual(withoutReset);
    fs.rmSync(file, { force: true });
  });

  it("returns null for a missing file", () => {
    expect(loadLastGoodFromDisk(path.join(os.tmpdir(), "does-not-exist-xyz.json"))).toBe(null);
  });

  it("rejects a malformed/incomplete snapshot", () => {
    fs.writeFileSync(file, JSON.stringify({ atMs: 1, windows: [{ label: "5h" }] }));
    expect(loadLastGoodFromDisk(file)).toBe(null);
    fs.rmSync(file, { force: true });
  });
});
