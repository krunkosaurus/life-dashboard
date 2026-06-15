import { describe, it, expect } from "vitest";
import {
  isAnniversaryEvent,
  byPinnedThenSoonest,
  milestone,
  byPinnedThenMilestone,
} from "../eventSort";
import type { EventItem } from "../types";

const ev = (over: Partial<EventItem>): EventItem => ({
  title: "x",
  start: 0,
  pinned: false,
  ...over,
});

// Mid-month, noon UTC: keeps the local calendar year/month stable across every
// real timezone (UTC-12 … UTC+14), so milestone/date assertions are TZ-robust.
const mid = (year: number, month0 = 6): number =>
  Math.floor(Date.UTC(year, month0, 15, 12, 0, 0) / 1000);

describe("isAnniversaryEvent", () => {
  it("matches birthdays-config entries and title keywords, not plain events", () => {
    expect(isAnniversaryEvent(ev({ anniversaryType: "birthday" }))).toBe(true);
    expect(isAnniversaryEvent(ev({ sinceYear: 1990 }))).toBe(true);
    expect(isAnniversaryEvent(ev({ title: "Wedding Anniversary" }))).toBe(true);
    expect(isAnniversaryEvent(ev({ title: "Bob's Birthday" }))).toBe(true);
    expect(isAnniversaryEvent(ev({ title: "Flight to Tokyo" }))).toBe(false);
  });
});

describe("byPinnedThenSoonest", () => {
  it("keeps pinned on top, then orders soonest first", () => {
    const events = [
      ev({ title: "later", start: 300 }),
      ev({ title: "pinned-late", start: 400, pinned: true }),
      ev({ title: "soon", start: 100 }),
    ];
    expect([...events].sort(byPinnedThenSoonest).map(e => e.title)).toEqual([
      "pinned-late",
      "soon",
      "later",
    ]);
  });
});

describe("milestone", () => {
  it("is the next-occurrence year minus the origin year, or Infinity without one", () => {
    expect(milestone(ev({ start: mid(2026), sinceYear: 1996 }))).toBe(30);
    expect(milestone(ev({ start: mid(2026) }))).toBe(Infinity);
  });
});

describe("byPinnedThenMilestone", () => {
  it("orders by upcoming milestone ascending, undated entries last, pinned on top", () => {
    const turning4 = ev({ title: "turning4", start: mid(2026), sinceYear: 2022 });
    const turning44 = ev({ title: "turning44", start: mid(2026), sinceYear: 1982 });
    const noYear = ev({ title: "noYear", start: mid(2026) });
    const pinned = ev({ title: "pinned", start: mid(2026), sinceYear: 1900, pinned: true });
    const sorted = [turning44, noYear, turning4, pinned].sort(byPinnedThenMilestone);
    expect(sorted.map(e => e.title)).toEqual(["pinned", "turning4", "turning44", "noYear"]);
  });

  it("breaks milestone ties by calendar date", () => {
    const march = ev({ title: "march", start: mid(2026, 2), sinceYear: 1996 });
    const july = ev({ title: "july", start: mid(2026, 6), sinceYear: 1996 });
    expect([july, march].sort(byPinnedThenMilestone).map(e => e.title)).toEqual([
      "march",
      "july",
    ]);
  });
});
