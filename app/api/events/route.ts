import { NextResponse } from "next/server";
import { loadAllEvents } from "@/lib/calendar";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadConfig();
  const result = await loadAllEvents({
    icsUrl: cfg.icsUrl,
    manualEvents: cfg.manualEvents,
    pinnedKeywords: cfg.pinnedEvents,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
