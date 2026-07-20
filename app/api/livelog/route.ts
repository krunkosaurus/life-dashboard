import { NextResponse } from "next/server";
import { getLiveLog } from "@/lib/livelog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getLiveLog(), { headers: { "Cache-Control": "no-store" } });
}
