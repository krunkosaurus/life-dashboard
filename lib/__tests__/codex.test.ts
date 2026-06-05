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

  it("returns ok:false when a window is missing", () => {
    const result = parseRateLimitsResult(
      { rateLimits: { primary: { usedPercent: 5, resetsAt: 1 } } },
      0
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when usedPercent is null", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: null, resetsAt: 1780153759 },
          secondary: { usedPercent: 100, resetsAt: 1780172156 },
        },
      },
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

  it("returns ok:false when resetsAt is missing", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 0 },
          secondary: { usedPercent: 100, resetsAt: 1780172156 },
        },
      },
      0
    );
    expect(result.ok).toBe(false);
  });
});
