import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { applyToggle, type ToggleScope } from "@/lib/checklistState";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status: 400, headers: { "Cache-Control": "no-store" } }
  );
}

// The set of ids the current config defines — a toggle for any other id is
// rejected so a stale client can't persist orphan keys.
function knownIds(): Set<string> {
  const cfg = loadConfig();
  const ids = new Set<string>();
  if (cfg.checklists) for (const it of cfg.checklists.items) ids.add(it.id);
  return ids;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON body");
  }
  if (!body || typeof body !== "object") return bad("invalid body");
  const { scope, key, id, value } = body as Record<string, unknown>;

  if (scope !== "day" && scope !== "week") return bad("scope must be 'day' or 'week'");
  if (typeof key !== "string" || !DATE_RE.test(key)) return bad("key must be YYYY-MM-DD");
  if (typeof id !== "string" || id.trim() === "") return bad("id is required");
  if (typeof value !== "boolean") return bad("value must be a boolean");
  if (!knownIds().has(id)) return bad("unknown checklist id");

  applyToggle({ scope: scope as ToggleScope, key, id, value });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
