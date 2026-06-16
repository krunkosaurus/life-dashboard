// Checklists: recurring personal tasks grouped into labeled sections, each with
// a cadence (daily, weekly, or specific weekdays). This module holds the pure,
// timezone-agnostic config parsing and date/due logic; persistence lives in
// checklistState.ts and the UI owns "what day it is" (local time), passing
// date-string keys to the server so the stored day is always the user's local day.

// Type-only import: erased at build, so the pure helpers below stay safe to use
// from client components without pulling checklistState's node:fs into the bundle.
import type { ChecklistState } from "./checklistState";

export type { ChecklistState };

// 0=Sun .. 6=Sat, matching JS Date.getDay().
export type ChecklistRepeat = "daily" | "weekly" | { weekdays: number[] };

// A resolved, client-facing item (what the panel renders and toggles).
export type ChecklistItem = {
  id: string;
  label: string;
  repeat: ChecklistRepeat;
};

// A parsed item still carrying its group (used to build ordered groups).
export type ChecklistConfigItem = ChecklistItem & { group: string };

// Parsed template (stored on AppConfig), resolved to groups by resolveChecklist.
export type ChecklistConfig = {
  title: string;
  weekStart: number;     // 0=Sun .. 6=Sat
  groupOrder: string[];  // explicit display order (may be empty)
  items: ChecklistConfigItem[];
};

export type ChecklistGroup = { name: string; items: ChecklistItem[] }; // name "" = group-less

export type ResolvedChecklist = {
  title: string;
  weekStart: number;
  groups: ChecklistGroup[];
};

// What GET /api/checklists returns: definition + full history, or an error
// (e.g. nothing configured) which the panel treats as "hidden".
export type ChecklistResult =
  | { ok: true; checklist: ResolvedChecklist; state: ChecklistState }
  | { ok: false; error: string };

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

// A weekday token ("mon", "Monday", "SAT") → 0–6, or null when unrecognized.
function parseWeekday(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const key = token.trim().toLowerCase();
  return key in WEEKDAYS ? WEEKDAYS[key] : null;
}

// weekStart accepts the same weekday tokens; anything else falls back to Monday.
function parseWeekStart(input: unknown): number {
  const wd = parseWeekday(input);
  return wd == null ? 1 : wd;
}

// Omitted → daily. "daily"/"weekly" (case-insensitive) pass through. An array of
// weekday tokens becomes a deduped, sorted { weekdays }. Returns null for an
// unrecognized scalar or an array that yields no valid days, so the caller drops
// the item (mirrors the defensive parsing of manualEvents/analytics).
function normalizeRepeat(input: unknown): ChecklistRepeat | null {
  if (input === undefined) return "daily";
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    return s === "daily" || s === "weekly" ? s : null;
  }
  if (Array.isArray(input)) {
    const days = Array.from(
      new Set(input.map(parseWeekday).filter((n): n is number => n != null))
    ).sort((a, b) => a - b);
    return days.length > 0 ? { weekdays: days } : null;
  }
  return null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Stable persistence key derived from group + label, so the same label in two
// groups (Morning/Lunch/Dinner "Olive oil") stays distinct.
function deriveId(group: string, label: string): string {
  return slug([group, label].filter(Boolean).join(" ")) || "item";
}

export function parseChecklists(input: unknown): ChecklistConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const seen = new Set<string>();
  const items: ChecklistConfigItem[] = itemsRaw.flatMap((raw): ChecklistConfigItem[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.label !== "string" || r.label.trim() === "") return [];
    const label = r.label.trim();
    const repeat = normalizeRepeat(r.repeat);
    if (repeat === null) return [];
    const group = typeof r.group === "string" ? r.group.trim() : "";

    let id =
      typeof r.id === "string" && r.id.trim() !== "" ? r.id.trim() : deriveId(group, label);
    // Guarantee a unique persistence key even on duplicate labels/ids.
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seen.add(id);

    return [{ id, label, group, repeat }];
  });

  if (items.length === 0) return null;

  const groupOrder = Array.isArray(o.groups)
    ? o.groups.filter((g): g is string => typeof g === "string")
    : [];
  const title =
    typeof o.title === "string" && o.title.trim() !== "" ? o.title.trim() : "Checklists";
  const weekStart = parseWeekStart(o.weekStart);

  return { title, weekStart, groupOrder, items };
}

// Order groups for display: every group named in groupOrder first — even one with
// no items, so it renders as an empty column — then any remaining groups that have
// items in first-seen order, with the group-less bucket last.
export function resolveChecklist(cfg: ChecklistConfig): ResolvedChecklist {
  const present: string[] = [];
  for (const it of cfg.items) if (!present.includes(it.group)) present.push(it.group);

  const ordered: string[] = [];
  for (const name of cfg.groupOrder) {
    if (name !== "" && !ordered.includes(name)) ordered.push(name);
  }
  for (const name of present) {
    if (name !== "" && !ordered.includes(name)) ordered.push(name);
  }
  if (present.includes("")) ordered.push("");

  const groups: ChecklistGroup[] = ordered.map((name) => ({
    name,
    items: cfg.items
      .filter((it) => it.group === name)
      .map(({ id, label, repeat }) => ({ id, label, repeat })),
  }));

  return { title: cfg.title, weekStart: cfg.weekStart, groups };
}

// Whether an item should appear on the given (local) day. Daily and weekly items
// show every day — "done" for a weekly item is read from its week bucket, not
// from being due; weekday items show only on their listed days.
export function isDueOn(item: ChecklistItem, date: Date): boolean {
  if (item.repeat === "daily" || item.repeat === "weekly") return true;
  return item.repeat.weekdays.includes(date.getDay());
}

// Local YYYY-MM-DD (no UTC drift), and its inverse to a local midnight Date.
export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// The YYYY-MM-DD of the week-start weekday on or before `date` — the persistence
// key for weekly items, so any day in the week reads/writes the same box.
export function weekStartDateOf(date: Date, weekStart: number): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return ymd(d);
}
