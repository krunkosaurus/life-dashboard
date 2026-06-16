import fs from "node:fs";
import path from "node:path";

// Server-side check-off history: a dumb key→bool store, no checklist definitions.
// Daily / specific-weekday items are keyed under `days` by date (YYYY-MM-DD);
// weekly items under `weeks` by their week-start date. The client supplies the
// keys (it owns the local calendar), so this file stays timezone-agnostic.
export type ChecklistState = {
  version: number;
  days: Record<string, Record<string, boolean>>;
  weeks: Record<string, Record<string, boolean>>;
};

export type ToggleScope = "day" | "week";

export type ToggleInput = {
  scope: ToggleScope;
  key: string; // YYYY-MM-DD (day) or week-start YYYY-MM-DD (week)
  id: string;
  value: boolean;
};

// Resolved per call (not at module load) so tests can point it at a temp file.
function statePath(): string {
  return (
    process.env.CHECKLIST_STATE_PATH ||
    path.join(process.cwd(), ".cache", "checklist-state.json")
  );
}

function emptyState(): ChecklistState {
  return { version: 1, days: {}, weeks: {} };
}

function isBucketMap(v: unknown): v is Record<string, Record<string, boolean>> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Read + parse, tolerating a missing or corrupt file by returning empty state
// (mirrors the last-good snapshot resilience in claude.ts).
export function readState(): ChecklistState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyState();
    const o = parsed as Record<string, unknown>;
    return {
      version: 1,
      days: isBucketMap(o.days) ? o.days : {},
      weeks: isBucketMap(o.weeks) ? o.weeks : {},
    };
  } catch {
    return emptyState();
  }
}

// Read-modify-write one id. `false` deletes the id (and prunes the bucket when it
// empties) to keep the file minimal. Single-user, serial low-rate writes — no
// locking, same as the rest of the app's on-disk caches.
export function applyToggle(input: ToggleInput): ChecklistState {
  const state = readState();
  const buckets = input.scope === "week" ? state.weeks : state.days;
  const bucket = buckets[input.key] ?? {};

  if (input.value) bucket[input.id] = true;
  else delete bucket[input.id];

  if (Object.keys(bucket).length > 0) buckets[input.key] = bucket;
  else delete buckets[input.key];

  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
  return state;
}
