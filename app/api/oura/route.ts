import { NextResponse } from "next/server";
import { fetchOuraStats } from "@/lib/oura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseDayOffset(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const day = url.searchParams.get("date") ?? undefined;
  const dayOffset = parseDayOffset(url.searchParams.get("dayOffset"));
  return NextResponse.json(
    await fetchOuraStats(request.url, { day, dayOffset }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
