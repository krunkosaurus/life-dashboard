import { NextResponse } from "next/server";
import { fetchCodexRateLimit } from "@/lib/codex";

export const dynamic = "force-dynamic";

// Cached + failure-logged in lib/codex.ts so an open dashboard doesn't spawn a
// `codex app-server` process on every poll.
export async function GET() {
  return NextResponse.json(await fetchCodexRateLimit(), { headers: { "Cache-Control": "no-store" } });
}
