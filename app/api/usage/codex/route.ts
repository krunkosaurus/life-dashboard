import { NextResponse } from "next/server";
import { readLatestCodexRateLimit } from "@/lib/codex";
import { recordFailure } from "@/lib/failures";
import type { UsageFailure } from "@/lib/types";

export const dynamic = "force-dynamic";

// Recent fetch failures, surfaced in the payload so the UI can show a small
// error history. In-memory only; resets on restart.
let failureLog: UsageFailure[] = [];

export async function GET() {
  const result = await readLatestCodexRateLimit();
  if (!result.ok) {
    console.error(`[codex-usage] fetch failed: ${result.error}`);
    failureLog = recordFailure(failureLog, result.error, Math.floor(Date.now() / 1000));
  }
  const body = failureLog.length > 0 ? { ...result, failures: failureLog } : result;
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
