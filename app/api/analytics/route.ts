import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function parseWeekOffset(raw: string | null): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekOffset = parseWeekOffset(url.searchParams.get("weekOffset"));
  return NextResponse.json(await getAnalytics({ weekOffset }), { headers: { "Cache-Control": "no-store" } });
}
