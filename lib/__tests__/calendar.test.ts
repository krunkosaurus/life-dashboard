import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseEvents, parseManualEvents, mergeEvents } from "../calendar";

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
