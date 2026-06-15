import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseEvents, parseManualEvents, mergeEvents, parseAnniversaries } from "../calendar";

const ics = fs.readFileSync(
  path.join(__dirname, "fixtures/sample.ics"),
  "utf8"
);
const NOW = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);

describe("parseEvents", () => {
  it("drops events that already ended before now", () => {
    const events = parseEvents(ics, [], NOW);
    expect(events.map(e => e.title)).not.toContain("Old meeting");
  });

  it("sorts upcoming events soonest first", () => {
    const events = parseEvents(ics, [], NOW);
    expect(events[0].title).toBe("Lunch");
    expect(events[1].title).toBe("Flight to Tokyo");
  });

  it("flags events matching pinnedEvents (case-insensitive substring) and sorts them first", () => {
    const events = parseEvents(ics, ["flight"], NOW);
    expect(events[0].title).toBe("Flight to Tokyo");
    expect(events[0].pinned).toBe(true);
    expect(events[1].pinned).toBe(false);
  });
});

describe("parseManualEvents", () => {
  it("parses ISO datetimes and date-only strings, drops invalid + past", () => {
    const items = [
      { title: "Future ISO",   start: "2099-06-15T08:00:00Z" },
      { title: "Future date",  start: "2099-09-12" },
      { title: "Bad date",     start: "not-a-date" },
      { title: "Past",         start: "2000-01-01" },
    ];
    const events = parseManualEvents(items, [], NOW);
    expect(events.map(e => e.title)).toEqual(["Future ISO", "Future date"]);
  });

  it("pinned: true on the input takes effect even without a matching keyword", () => {
    const events = parseManualEvents(
      [{ title: "Vacation", start: "2099-12-01", pinned: true }],
      [],
      NOW,
    );
    expect(events[0].pinned).toBe(true);
  });

  it("keyword match also pins (explicit OR keyword)", () => {
    const events = parseManualEvents(
      [{ title: "Flight to Tokyo", start: "2099-12-01" }],
      ["flight"],
      NOW,
    );
    expect(events[0].pinned).toBe(true);
  });
});

describe("mergeEvents", () => {
  it("dedupes by title+start and re-sorts pinned-first then earliest", () => {
    const a = [
      { title: "Flight", start: 200, pinned: true },
      { title: "Dentist", start: 300, pinned: false },
    ];
    const b = [
      { title: "Flight", start: 200, pinned: false },   // dup of a[0]
      { title: "Lunch",  start: 100, pinned: false },
    ];
    const merged = mergeEvents(a, b);
    expect(merged.map(e => e.title)).toEqual(["Flight", "Lunch", "Dentist"]);
    expect(merged[0].pinned).toBe(true);
  });
});

describe("parseAnniversaries", () => {
  // parseAnniversaries builds dates at 08:00 local; construct `now` in local time
  // and assert with local getters so these stay correct in any timezone.
  const localSec = (y: number, m0: number, d: number) =>
    Math.floor(new Date(y, m0, d, 0, 0, 0).getTime() / 1000);

  it("clamps a Feb 29 entry to Feb 28 in a common year (no Mar 1 overflow)", () => {
    const [item] = parseAnniversaries(
      [{ name: "Leap", month: 2, day: 29 }],
      localSec(2027, 0, 1), // Jan 1 2027 (common year)
    );
    const d = new Date(item.start * 1000);
    expect(d.getMonth()).toBe(1); // February, not March
    expect(d.getDate()).toBe(28);
  });

  it("keeps Feb 29 in a leap year", () => {
    const [item] = parseAnniversaries(
      [{ name: "Leap", month: 2, day: 29 }],
      localSec(2028, 0, 1), // Jan 1 2028 (leap year)
    );
    const d = new Date(item.start * 1000);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it("rolls to next year once this year's date has already passed", () => {
    const [item] = parseAnniversaries(
      [{ name: "NewYearish", month: 1, day: 15 }],
      localSec(2026, 5, 1), // Jun 1 2026, after Jan 15
    );
    const d = new Date(item.start * 1000);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it("derives birthday vs anniversary title/type and carries sinceYear", () => {
    const events = parseAnniversaries(
      [
        { name: "Ada", month: 7, day: 8, year: 1815 },
        { name: "Ada & Charles", type: "anniversary", label: "Wedding", month: 7, day: 8, year: 1835 },
      ],
      localSec(2026, 0, 1),
    );
    expect(events[0].title).toBe("Ada's Birthday");
    expect(events[0].anniversaryType).toBe("birthday");
    expect(events[0].sinceYear).toBe(1815);
    expect(events[1].title).toBe("Wedding"); // label overrides
    expect(events[1].anniversaryType).toBe("anniversary");
  });
});
