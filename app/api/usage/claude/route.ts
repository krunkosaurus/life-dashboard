import { NextResponse } from "next/server";
import { fetchClaudeUsage } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchClaudeUsage();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
