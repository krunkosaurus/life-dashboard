import { describe, expect, it } from "vitest";
import { applyClaudeAccountsResponse, replaceClaudeAccountUsage } from "../claudeUsageList";
import type { ClaudeAccountUsage, UsageResult } from "../types";

const ok: UsageResult = { ok: true, windows: [{ label: "5h", usedPercent: 12 }] };
const known: ClaudeAccountUsage[] = [
  { id: "sogni", label: "Claude · sogni", usage: ok },
  { id: "personal", label: "Claude · personal", usage: ok },
];

describe("applyClaudeAccountsResponse", () => {
  it("takes the accounts from a successful response", () => {
    const next = [{ id: "sogni", label: "Claude · sogni", usage: ok }];
    expect(applyClaudeAccountsResponse(known, { accounts: next })).toBe(next);
  });

  it("keeps the known panels and shows the error in each when the request fails", () => {
    expect(applyClaudeAccountsResponse(known, { ok: false, error: "request failed: offline" })).toEqual([
      { id: "sogni", label: "Claude · sogni", usage: { ok: false, error: "request failed: offline" } },
      { id: "personal", label: "Claude · personal", usage: { ok: false, error: "request failed: offline" } },
    ]);
  });

  it("shows one Claude Code panel with the error when nothing is known yet", () => {
    expect(applyClaudeAccountsResponse(null, { ok: false, error: "request failed: offline" })).toEqual([
      { id: "default", label: "Claude Code", usage: { ok: false, error: "request failed: offline" } },
    ]);
  });

  it("treats a response without an accounts list as a failure", () => {
    expect(applyClaudeAccountsResponse(null, {} as never)).toEqual([
      { id: "default", label: "Claude Code", usage: { ok: false, error: "unexpected response" } },
    ]);
  });
});

describe("replaceClaudeAccountUsage", () => {
  const failed: UsageResult = { ok: false, error: "rate limited" };

  it("replaces only the named account's usage", () => {
    expect(replaceClaudeAccountUsage(known, "personal", failed)).toEqual([
      known[0],
      { id: "personal", label: "Claude · personal", usage: failed },
    ]);
  });

  it("leaves an empty state alone", () => {
    expect(replaceClaudeAccountUsage(null, "personal", failed)).toBeNull();
  });
});
