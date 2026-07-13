import { describe, it, expect } from "vitest";
import { parseRateLimitsResult } from "../codex";

// Shape returned by the codex app-server `account/rateLimits/read` JSON-RPC.
const liveResult = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1780153759 },
    secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1780172156 },
    planType: "pro",
  },
};

describe("parseRateLimitsResult", () => {
  it("maps primary -> 5h and secondary -> weekly", () => {
    const result = parseRateLimitsResult(liveResult, 1780135575);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "5h", usedPercent: 0, resetAt: 1780153759, windowSecs: 18000 },
      { label: "weekly", usedPercent: 100, resetAt: 1780172156, windowSecs: 604800 },
    ]);
    expect(result.snapshotAt).toBe(1780135575);
  });

  it("returns ok:false when rateLimits is absent", () => {
    expect(parseRateLimitsResult({}, 0).ok).toBe(false);
    expect(parseRateLimitsResult(null, 0).ok).toBe(false);
  });

  it("accepts a primary-only weekly window returned by current Codex", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 4, windowDurationMins: 10080, resetsAt: 1784487735 },
          secondary: null,
          planType: "pro",
        },
      },
      1783926592
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "weekly", usedPercent: 4, resetAt: 1784487735, windowSecs: 604800 },
    ]);
    expect(result.snapshotAt).toBe(1783926592);
  });

  it("uses the positional label when an older response omits duration", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 5, resetsAt: 1780153759 },
          secondary: null,
        },
      },
      0
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "5h", usedPercent: 5, resetAt: 1780153759 },
    ]);
  });

  it("keeps a usable window when its sibling is malformed", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: null, resetsAt: 1780153759 },
          secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1780172156 },
        },
      },
      0
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "weekly", usedPercent: 100, resetAt: 1780172156, windowSecs: 604800 },
    ]);
  });

  it("returns ok:false when no window has numeric usedPercent", () => {
    const result = parseRateLimitsResult(
      { rateLimits: { primary: { usedPercent: null }, secondary: null } },
      0
    );
    expect(result.ok).toBe(false);
  });

  it("omits windowSecs when windowDurationMins is null or missing", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: null, resetsAt: 1780153759 },
          secondary: { usedPercent: 10, resetsAt: 1780172156 },
        },
      },
      0
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows[0]).not.toHaveProperty("windowSecs");
    expect(result.windows[1]).not.toHaveProperty("windowSecs");
  });

  it("accepts null or missing resetsAt and omits the reset timestamp", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: null },
          secondary: { usedPercent: 100, windowDurationMins: 10080 },
        },
      },
      0
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "5h", usedPercent: 0, windowSecs: 18000 },
      { label: "weekly", usedPercent: 100, windowSecs: 604800 },
    ]);
  });

  it("rejects a non-numeric reset timestamp when no other window is usable", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 0, resetsAt: "tomorrow" },
          secondary: null,
        },
      },
      0
    );
    expect(result.ok).toBe(false);
  });
});
