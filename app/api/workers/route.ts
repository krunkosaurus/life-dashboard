import { NextResponse } from "next/server";
import { fetchWorkers } from "@/lib/workers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await fetchWorkers(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The worker snapshot could not start. Check the dashboard installation." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
