import { describe, it, expect } from "vitest";
import {
  analyticsRangeForWeekOffset,
  formatDay,
  requestedDaysForWeekOffset,
  resolveCharts,
  rowsForWeekOffset,
} from "../analytics";

describe("analyticsRangeForWeekOffset", () => {
  const now = new Date("2026-06-22T12:00:00Z");

  it("uses the current UTC rolling 7-day range for offset 0", () => {
    expect(analyticsRangeForWeekOffset(0, now)).toEqual({
      startDate: "2026-06-16",
      endDate: "2026-06-22",
      weekOffset: 0,
    });
  });

  it("moves the selected UTC range by whole weeks into the past", () => {
    expect(analyticsRangeForWeekOffset(-1, now)).toEqual({
      startDate: "2026-06-09",
      endDate: "2026-06-15",
      weekOffset: -1,
    });
  });

  it("clamps future offsets to the current range", () => {
    expect(analyticsRangeForWeekOffset(1, now)).toEqual(analyticsRangeForWeekOffset(0, now));
  });
});

describe("requestedDaysForWeekOffset", () => {
  it("requests enough lookback rows to slice the selected week locally", () => {
    expect(requestedDaysForWeekOffset(0)).toBe(7);
    expect(requestedDaysForWeekOffset(-1)).toBe(14);
    expect(requestedDaysForWeekOffset(-2)).toBe(21);
  });
});

describe("rowsForWeekOffset", () => {
  const rows = Array.from({ length: 14 }, (_, i) => i + 1);

  it("keeps the current 7 rows at offset 0", () => {
    expect(rowsForWeekOffset(rows, 0)).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });

  it("selects the previous 7 rows for one week back", () => {
    expect(rowsForWeekOffset(rows, -1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("formatDay", () => {
  it("formats an ISO date as 'Mon D - Weekday' in UTC", () => {
    expect(formatDay("2026-06-08")).toBe("Jun 8 - Mon");
    expect(formatDay("2026-12-31")).toBe("Dec 31 - Thu");
  });

  it("returns the input unchanged when unparseable", () => {
    expect(formatDay("not-a-date")).toBe("not-a-date");
  });
});

describe("resolveCharts", () => {
  const rows = [
    { date: "2026-06-08", batches: 0, photos: 0 },
    { date: "2026-06-09", batches: 3, photos: 26 },
  ];

  it("pulls each series' field across rows and derives day labels", () => {
    const { days, charts } = resolveCharts(
      [
        {
          title: "Generation",
          series: [
            { label: "Batches", field: "batches" },
            { label: "Photos", field: "photos" },
          ],
        },
      ],
      rows
    );
    expect(days).toEqual(["Jun 8 - Mon", "Jun 9 - Tue"]);
    expect(charts[0].series[0]).toEqual({ label: "Batches", values: [0, 3] });
    expect(charts[0].series[1]).toEqual({ label: "Photos", values: [0, 26] });
  });

  it("coerces missing or non-numeric field values to 0", () => {
    const { charts } = resolveCharts(
      [{ title: "C", series: [{ label: "S", field: "missing" }] }],
      [{ date: "2026-06-08" }, { date: "2026-06-09", missing: "x" }]
    );
    expect(charts[0].series[0].values).toEqual([0, 0]);
  });

  it("passes through static values when a series has no field", () => {
    const { days, charts } = resolveCharts(
      [{ title: "C", series: [{ label: "S", values: [5, 6, 7] }] }],
      []
    );
    expect(days).toEqual([]);
    expect(charts[0].series[0].values).toEqual([5, 6, 7]);
  });

  it("derives day labels from a custom dateField", () => {
    const { days } = resolveCharts(
      [{ title: "C", series: [{ label: "S", field: "v" }] }],
      [
        { day: "2026-06-08", v: 1 },
        { day: "2026-06-09", v: 2 },
      ],
      "day"
    );
    expect(days).toEqual(["Jun 8 - Mon", "Jun 9 - Tue"]);
  });
});
