import { NextResponse } from "next/server";
import { fetchClaudeUsage } from "@/lib/claude";
import { findClaudeAccount } from "@/lib/claudeAccounts";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Without `account` this answers for the default-profile account, which is
// the same response as before multiple accounts existed.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = findClaudeAccount(loadConfig().claudeAccounts, params.get("account"));
  if (!account) {
    return NextResponse.json({ ok: false, error: "unknown Claude account" }, { status: 404, headers: NO_STORE });
  }
  const result = await fetchClaudeUsage({ forceRefresh: params.get("refresh") === "1", account });
  return NextResponse.json(result, { headers: NO_STORE });
}
