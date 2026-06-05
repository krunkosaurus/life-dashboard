import ical from "node-ical";
import type { EventItem, EventsResult, ManualEventInput } from "./types";

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
  pinnedKeywords: string[];
}): Promise<EventsResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const manual = parseManualEvents(opts.manualEvents, opts.pinnedKeywords, nowSec);

  if (!opts.icsUrl) {
    if (manual.length === 0 && opts.manualEvents.length === 0) {
      return { ok: false, error: "no events configured — set icsUrl or manualEvents in config.local.json" };
    }
    return { ok: true, events: mergeEvents(manual, []) };
  }

  const ics = await fetchEvents(opts.icsUrl, opts.pinnedKeywords);
  if (!ics.ok) {
    // If manual events exist, show them even when ICS fails; otherwise
    // surface the ICS error.
    if (manual.length > 0) return { ok: true, events: mergeEvents(manual, []) };
    return ics;
  }
  return { ok: true, events: mergeEvents(manual, ics.events) };
}
