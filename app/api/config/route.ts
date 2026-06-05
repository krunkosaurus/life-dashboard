import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Exposes only the client-relevant config. Never returns icsUrl (secret) or
// raw manualEvents — those are served, already filtered, via /api/events.
export async function GET() {
  const cfg = loadConfig();
  return NextResponse.json(
    { refreshSeconds: cfg.refreshSeconds, life: cfg.life },
    { headers: { "Cache-Control": "no-store" } }
  );
}
