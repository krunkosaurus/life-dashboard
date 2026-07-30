import { afterEach, describe, it, expect, vi } from "vitest";
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
  hasNewerUsableCredential,
  refreshAccessToken,
  calculateRateLimitBackoff,
  fetchUsageWithToken,
  claudeUserAgentFromVersion,
  loadDashboardOauth,
  orderRefreshCredentialTokens,
  persistDashboardOauth,
  credentialFingerprint,
} from "../claude";

const dashboardOauthTestFile = path.join(os.tmpdir(), `life-dashboard-oauth-test-${process.pid}.json`);

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dashboardOauthTestFile, { force: true });
});

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

  it("orders and deduplicates every stored credential candidate", () => {
    expect(orderRefreshCredentialTokens([
      { refreshToken: "old", expiresAt: 1000 },
      null,
      { refreshToken: "new", expiresAt: 3000 },
      { refreshToken: "old", expiresAt: 2000 },
    ])).toEqual(["new", "old"]);
  });
});

describe("dashboard OAuth cache", () => {
  const oauth = {
    accessToken: "private-access-token-for-test",
    refreshToken: "private-refresh-token-for-test",
    expiresAt: 1_700_003_600_000,
  };

  it("persists rotated credentials privately for restart recovery", () => {
    persistDashboardOauth(oauth, dashboardOauthTestFile);

    expect(loadDashboardOauth(dashboardOauthTestFile)).toEqual(oauth);
    expect(fs.statSync(dashboardOauthTestFile).mode & 0o777).toBe(0o600);
  });

  it("rejects malformed cached credentials", () => {
    fs.writeFileSync(dashboardOauthTestFile, JSON.stringify({ accessToken: "incomplete" }));
    expect(loadDashboardOauth(dashboardOauthTestFile)).toBe(null);
  });
});

describe("claudeUserAgentFromVersion", () => {
  it("tracks the installed Claude Code version", () => {
    expect(claudeUserAgentFromVersion("2.1.215 (Claude Code)"))
      .toBe("claude-code/2.1.215");
  });

  it("uses a stable fallback for an unknown version shape", () => {
    expect(claudeUserAgentFromVersion("Claude Code development build"))
      .toBe("claude-code/life-dashboard");
  });
});

describe("credential-aware cache recovery", () => {
  const nowMs = 1_700_000_000_000;
  const current = {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: nowMs + 3600_000,
  };

  it("detects a newer valid credential", () => {
    expect(hasNewerUsableCredential("old-fingerprint", current, nowMs)).toBe(true);
  });

  it("ignores unchanged or expired credentials", () => {
    expect(hasNewerUsableCredential(credentialFingerprint(current), current, nowMs)).toBe(false);
    expect(hasNewerUsableCredential("old-fingerprint", { ...current, expiresAt: nowMs }, nowMs)).toBe(false);
  });
});

describe("refreshAccessToken", () => {
  it("matches Claude Code's JSON refresh request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await refreshAccessToken("refresh-token-for-test");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-token-for-test",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers",
    });
  });
});

describe("calculateRateLimitBackoff", () => {
  it("uses an explicit Retry-After value", () => {
    expect(calculateRateLimitBackoff(42_000, 4)).toBe(42_000);
  });

  it("backs off progressively when the server omits Retry-After", () => {
    expect([0, 1, 2, 3, 4, 5].map((streak) =>
      calculateRateLimitBackoff(null, streak)
    )).toEqual([
      15 * 60_000,
      30 * 60_000,
      60 * 60_000,
      2 * 60 * 60_000,
      4 * 60 * 60_000,
      4 * 60 * 60_000,
    ]);
  });

  it("honors long explicit Retry-After values", () => {
    expect(calculateRateLimitBackoff(24 * 60 * 60_000, 0)).toBe(24 * 60 * 60_000);
  });
});

describe("automatic 401 recovery", () => {
  it("reloads credentials and retries the usage request once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { type: "authentication_error", message: "expired" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const recoverToken = vi.fn().mockResolvedValue({ token: "replacement-access-token" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageWithToken("rejected-access-token", true, recoverToken);

    expect(result.result.ok).toBe(true);
    expect(recoverToken).toHaveBeenCalledWith("rejected-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer rejected-access-token",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer replacement-access-token",
    });
  });

  it("stops after one retry and schedules a prompt follow-up attempt", async () => {
    const unauthorized = () => new Response(
      JSON.stringify({ error: { type: "authentication_error", message: "expired" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized());
    const recoverToken = vi.fn().mockResolvedValue({ token: "second-rejected-token" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageWithToken("first-rejected-token", true, recoverToken);

    expect(result).toMatchObject({
      result: { ok: false, error: expect.stringContaining("usage endpoint HTTP 401") },
      ttl: 15_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recoverToken).toHaveBeenCalledOnce();
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
