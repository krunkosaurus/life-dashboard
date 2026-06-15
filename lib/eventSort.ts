import type { EventItem } from "./types";

// An event belongs in the Anniversaries panel when it came from the `birthdays`
// config (anniversaryType/sinceYear set) or its title mentions a birthday or
// anniversary. Everything else is a one-off Countdown.
export function isAnniversaryEvent(event: EventItem): boolean {
  return (
    event.anniversaryType != null ||
    event.sinceYear != null ||
    /\b(birthday|anniversary)\b/i.test(event.title)
  );
}

// Countdowns are one-off, so order by which finishes soonest. Pinned on top.
export function byPinnedThenSoonest(a: EventItem, b: EventItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.start - b.start;
}

// The upcoming year milestone for an anniversary (turning 4, turning 44, …):
// the next occurrence's year minus the origin year. Entries without an origin
// year have no milestone and sort last (Infinity).
export function milestone(e: EventItem): number {
  return e.sinceYear != null ? new Date(e.start * 1000).getFullYear() - e.sinceYear : Infinity;
}

// Anniversaries recur every year, so order them by their upcoming year milestone
// (smallest first, the longest milestone last); milestone ties break by calendar
// date. Pinned on top.
export function byPinnedThenMilestone(a: EventItem, b: EventItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const ma = milestone(a), mb = milestone(b);
  if (ma !== mb) return ma - mb;
  const da = new Date(a.start * 1000), db = new Date(b.start * 1000);
  return da.getMonth() - db.getMonth() || da.getDate() - db.getDate();
}
