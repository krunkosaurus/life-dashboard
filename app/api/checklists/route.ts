import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { resolveChecklist } from "@/lib/checklists";
import { readState } from "@/lib/checklistState";

export const dynamic = "force-dynamic";

// Definition + full check-off history in one payload (state is tiny). The client
// polls this on the usual refresh interval, so edits on another device show up
// within refreshSeconds. Returns ok:false when nothing is configured so the
// panel hides itself, mirroring the analytics route.
export async function GET() {
  const cfg = loadConfig();
  if (!cfg.checklists) {
    return NextResponse.json(
      { ok: false, error: "no checklists configured" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const checklist = resolveChecklist(cfg.checklists);
  const state = readState();
  return NextResponse.json(
    { ok: true, checklist, state },
    { headers: { "Cache-Control": "no-store" } }
  );
}
