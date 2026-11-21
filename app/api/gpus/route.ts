import { NextResponse } from "next/server";
import { fetchGpuHealth } from "@/lib/gpuHealth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await fetchGpuHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The GPU health collector could not start. Check the dashboard installation." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
