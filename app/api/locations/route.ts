import { NextResponse } from "next/server";
import { fetchClimate } from "@/lib/climate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await fetchClimate(), { headers: { "Cache-Control": "no-store" } });
}
