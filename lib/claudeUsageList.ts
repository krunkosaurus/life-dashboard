import type { ClaudeAccountUsage, ClaudeAccountsResult, UsageResult } from "./types";

// Browser-side list updates for the Claude usage panels. Kept free of node
// imports so the page can use it.

// Apply a poll of /api/usage/claude/accounts. When the request itself fails,
// keep the panels already known and show the error in each, rather than
// collapsing them into one; with nothing known yet, show one Claude Code panel.
export function applyClaudeAccountsResponse(
  previous: ClaudeAccountUsage[] | null,
  response: ClaudeAccountsResult | { ok: false; error: string },
): ClaudeAccountUsage[] {
  if ("accounts" in response && Array.isArray(response.accounts)) return response.accounts;
  const error = "error" in response && typeof response.error === "string" ? response.error : "unexpected response";
  const usage: UsageResult = { ok: false, error };
  const panels = previous ?? [{ id: "default", label: "Claude Code" }];
  return panels.map(({ id, label }) => ({ id, label, usage }));
}

// A manual check updates one account and leaves the others as they were.
export function replaceClaudeAccountUsage(
  list: ClaudeAccountUsage[] | null,
  id: string,
  usage: UsageResult,
): ClaudeAccountUsage[] | null {
  return list ? list.map(account => (account.id === id ? { ...account, usage } : account)) : list;
}
