import ical from "node-ical";
import type { BirthdayInput, EventItem, EventsResult, ManualEventInput } from "./types";

export function parseEvents(icsText: string, pinned: string[], nowSec: number): EventItem[] {
  const data = ical.sync.parseICS(icsText);
  const lowered = pinned.map(p => p.toLowerCase());
  const items: EventItem[] = [];
  for (const v of Object.values(data)) {
    if ((v as { type?: string }).type !== "VEVENT") continue;
    const e = v as { summary?: string; start?: Date };
    if (!e.summary || !e.start) continue;
    const start = Math.floor(e.start.getTime() / 1000);
    if (start < nowSec) continue;
    const title = e.summary;
    const isPinned = lowered.some(p => title.toLowerCase().includes(p));
    items.push({ title, start, pinned: isPinned });
  }
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.start - b.start;
  });
  return items;
}

export async function fetchEvents(url: string, pinned: string[]): Promise<EventsResult> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} fetching .ics` };
    const text = await res.text();
    const events = parseEvents(text, pinned, Math.floor(Date.now() / 1000));
    return { ok: true, events };
  } catch (e) {
    // Avoid leaking the (secret) icsUrl back to the browser via the error
    // message — Node's fetch errors routinely include the hostname.
    const name = e instanceof Error ? e.name || "Error" : "unknown";
    return { ok: false, error: `fetch failed: ${name}` };
  }
}

export function parseManualEvents(items: ManualEventInput[], pinnedKeywords: string[], nowSec: number): EventItem[] {
  const lowered = pinnedKeywords.map(p => p.toLowerCase());
  const out: EventItem[] = [];
  for (const e of items) {
    const t = Date.parse(e.start);
    if (!Number.isFinite(t)) continue;
    const start = Math.floor(t / 1000);
    if (start < nowSec) continue;
    const explicit = e.pinned === true;
    const keyword = lowered.some(p => e.title.toLowerCase().includes(p));
    out.push({ title: e.title, start, pinned: explicit || keyword });
  }
  return out;
}

// Build a local 08:00 Date for the given calendar day, clamping an out-of-range
// day down to the month's last valid day instead of letting JS overflow it into
// the next month. Keeps a Feb 29 anniversary on Feb 28 in common years (and a
// day-31 entry on the last of a 30-day month) rather than jumping to the 1st.
function anniversaryDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this one
  return new Date(year, month - 1, Math.min(day, lastDay), 8, 0, 0);
}

export function parseAnniversaries(items: BirthdayInput[], nowSec: number): EventItem[] {
  const nowMs = nowSec * 1000;
  return items.map(b => {
    const now = new Date(nowMs);
    const year = now.getFullYear();
    let candidate = anniversaryDate(year, b.month, b.day);
    if (candidate.getTime() <= nowMs) {
      candidate = anniversaryDate(year + 1, b.month, b.day);
    }
    const type = b.type === "anniversary" ? "anniversary" : "birthday";
    const title = b.label ?? (type === "birthday" ? `${b.name}'s Birthday` : b.name);
    const item: EventItem = {
      title,
      start: Math.floor(candidate.getTime() / 1000),
      pinned: false,
      anniversaryType: type,
    };
    if (b.year != null) item.sinceYear = b.year;
    return item;
  });
}

export function mergeEvents(a: EventItem[], b: EventItem[]): EventItem[] {
  const seen = new Set<string>();
  const merged: EventItem[] = [];
  for (const e of [...a, ...b]) {
    const key = `${e.title.trim().toLowerCase()}|${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  merged.sort((x, y) => {
    if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
    return x.start - y.start;
  });
  return merged;
}

export async function loadAllEvents(opts: {
  icsUrl: string | null;
  manualEvents: ManualEventInput[];
  birthdays: BirthdayInput[];
  pinnedKeywords: string[];
}): Promise<EventsResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const manual = parseManualEvents(opts.manualEvents, opts.pinnedKeywords, nowSec);
  const annivs = parseAnniversaries(opts.birthdays, nowSec);
  const local = mergeEvents(manual, annivs);

  if (!opts.icsUrl) {
    if (local.length === 0 && opts.manualEvents.length === 0 && opts.birthdays.length === 0) {
      return { ok: false, error: "no events configured — set icsUrl or manualEvents in config.local.json" };
    }
    return { ok: true, events: local };
  }

  const ics = await fetchEvents(opts.icsUrl, opts.pinnedKeywords);
  if (!ics.ok) {
    if (local.length > 0) return { ok: true, events: local };
    return ics;
  }
  return { ok: true, events: mergeEvents(local, ics.events) };
}
