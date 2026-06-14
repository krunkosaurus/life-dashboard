import { describe, it, expect } from "vitest";
import { formatDay, resolveCharts } from "../analytics";

describe("formatDay", () => {
  it("formats an ISO date as 'Mon D' in UTC", () => {
    expect(formatDay("2026-06-08")).toBe("Jun 8");
    expect(formatDay("2026-12-31")).toBe("Dec 31");
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
    expect(days).toEqual(["Jun 8", "Jun 9"]);
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
    expect(days).toEqual(["Jun 8", "Jun 9"]);
  });
});
