import { NextResponse } from "next/server";
import { fetchAllClaudeUsage } from "@/lib/claude";
import { loadConfig } from "@/lib/config";
import type { ClaudeAccountsResult } from "@/lib/types";

export const dynamic = "force-dynamic";

// Usage for every configured Claude account. Only ids and labels identify
// them; profile folders and credentials never leave the server.
export async function GET() {
  const body: ClaudeAccountsResult = { accounts: await fetchAllClaudeUsage(loadConfig().claudeAccounts) };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
