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

  it("returns null for a missing file", () => {
    expect(loadLastGoodFromDisk(path.join(os.tmpdir(), "does-not-exist-xyz.json"))).toBe(null);
  });

  it("rejects a malformed/incomplete snapshot", () => {
    fs.writeFileSync(file, JSON.stringify({ atMs: 1, windows: [{ label: "5h" }] }));
    expect(loadLastGoodFromDisk(file)).toBe(null);
    fs.rmSync(file, { force: true });
  });
});
