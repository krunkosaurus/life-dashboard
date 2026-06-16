import { describe, it, expect } from "vitest";
import {
  parseChecklists,
  resolveChecklist,
  isDueOn,
  weekStartDateOf,
  ymd,
  parseYmd,
} from "../checklists";
import type { ChecklistItem } from "../checklists";

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: "x",
  label: "X",
  repeat: "daily",
  ...over,
});

describe("parseChecklists", () => {
  it("returns null for missing, non-object, or item-less input", () => {
    expect(parseChecklists(undefined)).toBeNull();
    expect(parseChecklists(null)).toBeNull();
    expect(parseChecklists("nope")).toBeNull();
    expect(parseChecklists([])).toBeNull();
    expect(parseChecklists({})).toBeNull();
    expect(parseChecklists({ items: [] })).toBeNull();
    expect(parseChecklists({ items: "nope" })).toBeNull();
  });

  it("defaults title to 'Checklists' and weekStart to Monday (1)", () => {
    const cfg = parseChecklists({ items: [{ label: "A" }] })!;
    expect(cfg.title).toBe("Checklists");
    expect(cfg.weekStart).toBe(1);
  });

  it("reads title and weekStart, accepting weekday names case-insensitively", () => {
    expect(parseChecklists({ weekStart: "sun", items: [{ label: "A" }] })!.weekStart).toBe(0);
    expect(parseChecklists({ weekStart: "Sunday", items: [{ label: "A" }] })!.weekStart).toBe(0);
    expect(parseChecklists({ weekStart: "SAT", items: [{ label: "A" }] })!.weekStart).toBe(6);
    expect(parseChecklists({ title: "Daily Checklists", items: [{ label: "A" }] })!.title).toBe("Daily Checklists");
  });

  it("falls back to Monday for an invalid or blank weekStart", () => {
    expect(parseChecklists({ weekStart: "blursday", items: [{ label: "A" }] })!.weekStart).toBe(1);
    expect(parseChecklists({ weekStart: 99, items: [{ label: "A" }] })!.weekStart).toBe(1);
    expect(parseChecklists({ weekStart: "  ", items: [{ label: "A" }] })!.weekStart).toBe(1);
  });

  it("defaults repeat to daily and group to empty string when absent", () => {
    const cfg = parseChecklists({ items: [{ label: "Cold plunge" }] })!;
    expect(cfg.items[0]).toEqual({ id: "cold-plunge", label: "Cold plunge", group: "", repeat: "daily" });
  });

  it("normalizes weekly and weekday-array repeats (0=Sun..6=Sat)", () => {
    const cfg = parseChecklists({
      items: [
        { label: "W", repeat: "weekly" },
        { label: "MWF", repeat: ["mon", "wed", "fri"] },
        { label: "Caps", repeat: ["Tuesday", "THU"] },
      ],
    })!;
    expect(cfg.items[0].repeat).toBe("weekly");
    expect(cfg.items[1].repeat).toEqual({ weekdays: [1, 3, 5] });
    expect(cfg.items[2].repeat).toEqual({ weekdays: [2, 4] });
  });

  it("dedupes and sorts weekday tokens and drops unknown ones", () => {
    const cfg = parseChecklists({ items: [{ label: "X", repeat: ["fri", "mon", "mon", "nope"] }] })!;
    expect(cfg.items[0].repeat).toEqual({ weekdays: [1, 5] });
  });

  it("drops an item with an unrecognized repeat or an empty / all-invalid weekday array", () => {
    const cfg = parseChecklists({
      items: [
        { label: "Good", repeat: "daily" },
        { label: "Monthly?", repeat: "monthly" },
        { label: "EmptyArr", repeat: [] },
        { label: "AllBad", repeat: ["nope", "zzz"] },
      ],
    })!;
    expect(cfg.items.map((i) => i.label)).toEqual(["Good"]);
  });

  it("drops items with a missing/blank/non-string label and non-object entries", () => {
    const cfg = parseChecklists({
      items: [{ label: "Keep" }, { label: "   " }, { label: 5 }, { group: "Morning" }, "nope", null],
    })!;
    expect(cfg.items.map((i) => i.label)).toEqual(["Keep"]);
  });

  it("trims labels and derives distinct ids from group+label, suffixing collisions", () => {
    const cfg = parseChecklists({
      items: [
        { group: "Morning", label: "Olive oil" },
        { group: "Lunch", label: " Olive oil " },
        { group: "Dinner", label: "Olive oil" },
        { label: "Dupe" },
        { label: "Dupe" },
      ],
    })!;
    expect(cfg.items.map((i) => i.id)).toEqual([
      "morning-olive-oil",
      "lunch-olive-oil",
      "dinner-olive-oil",
      "dupe",
      "dupe-2",
    ]);
    expect(cfg.items[1].label).toBe("Olive oil");
  });

  it("honors an explicit id over the derived one", () => {
    const cfg = parseChecklists({ items: [{ label: "Cold plunge", id: "plunge" }] })!;
    expect(cfg.items[0].id).toBe("plunge");
  });

  it("keeps only string entries in groupOrder", () => {
    const cfg = parseChecklists({ groups: ["Morning", 2, null, "Nightly"], items: [{ label: "A" }] })!;
    expect(cfg.groupOrder).toEqual(["Morning", "Nightly"]);
  });
});

describe("resolveChecklist", () => {
  const cfg = parseChecklists({
    groups: ["Morning", "Nightly"],
    items: [
      { group: "Nightly", label: "Supplements" },
      { group: "Morning", label: "Cold plunge" },
      { group: "Weekly", label: "Long run", repeat: "weekly" },
      { label: "Floating" },
      { group: "Morning", label: "Squats" },
    ],
  })!;

  it("orders groups by explicit groupOrder, then first-seen, group-less last", () => {
    expect(resolveChecklist(cfg).groups.map((g) => g.name)).toEqual(["Morning", "Nightly", "Weekly", ""]);
  });

  it("keeps each group's items in input order, carrying id/label/repeat only", () => {
    const r = resolveChecklist(cfg);
    const morning = r.groups.find((g) => g.name === "Morning")!;
    expect(morning.items.map((i) => i.label)).toEqual(["Cold plunge", "Squats"]);
    const weekly = r.groups.find((g) => g.name === "Weekly")!;
    expect(weekly.items[0]).toEqual({ id: "weekly-long-run", label: "Long run", repeat: "weekly" });
  });

  it("passes through title and weekStart", () => {
    const r = resolveChecklist(cfg);
    expect(r.title).toBe("Checklists");
    expect(r.weekStart).toBe(1);
  });

  it("includes a group named in `groups` even when it has no items (empty column)", () => {
    const empty = parseChecklists({
      groups: ["Morning", "Weekly"],
      items: [{ group: "Morning", label: "Cold plunge" }],
    })!;
    const r = resolveChecklist(empty);
    expect(r.groups.map((g) => g.name)).toEqual(["Morning", "Weekly"]);
    expect(r.groups.find((g) => g.name === "Weekly")!.items).toEqual([]);
  });
});

describe("isDueOn", () => {
  const mon = new Date(2026, 5, 15); // Mon Jun 15 2026 (local)
  const wed = new Date(2026, 5, 17);

  it("daily and weekly items are due every day", () => {
    expect(isDueOn(item({ repeat: "daily" }), mon)).toBe(true);
    expect(isDueOn(item({ repeat: "daily" }), wed)).toBe(true);
    expect(isDueOn(item({ repeat: "weekly" }), wed)).toBe(true);
  });

  it("weekday items are due only on listed weekdays", () => {
    const mwf = item({ repeat: { weekdays: [1, 5] } }); // Mon, Fri
    expect(isDueOn(mwf, mon)).toBe(true);
    expect(isDueOn(mwf, wed)).toBe(false);
  });
});

describe("ymd / parseYmd", () => {
  it("formats and round-trips a local date with no timezone drift", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(ymd(parseYmd("2026-06-15"))).toBe("2026-06-15");
    const d = parseYmd("2026-06-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 15]);
  });
});

describe("weekStartDateOf", () => {
  it("returns the week-start date on or before the given date", () => {
    // Jun 15 2026 is a Monday; Jun 14 a Sunday.
    expect(weekStartDateOf(new Date(2026, 5, 15), 1)).toBe("2026-06-15"); // Mon start, on a Mon
    expect(weekStartDateOf(new Date(2026, 5, 17), 1)).toBe("2026-06-15"); // Wed -> back to Mon
    expect(weekStartDateOf(new Date(2026, 5, 14), 1)).toBe("2026-06-08"); // Sun -> previous Mon
    expect(weekStartDateOf(new Date(2026, 5, 15), 0)).toBe("2026-06-14"); // Sun start -> Sun Jun 14
  });
});
