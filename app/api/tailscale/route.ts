import { NextResponse } from "next/server";
import { fetchTailscaleStatus } from "@/lib/tailscale";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchTailscaleStatus();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
