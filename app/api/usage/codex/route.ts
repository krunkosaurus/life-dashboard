import { NextResponse } from "next/server";
import { readLatestCodexRateLimit } from "@/lib/codex";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readLatestCodexRateLimit();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
