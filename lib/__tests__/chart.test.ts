import { describe, it, expect } from "vitest";
import { niceScale, statsForDay } from "../chart";

describe("niceScale", () => {
  it("rounds a large max up to round ticks", () => {
    expect(niceScale(870)).toEqual({ max: 1000, step: 200, ticks: [0, 200, 400, 600, 800, 1000] });
  });

  it("handles mid ranges", () => {
    expect(niceScale(61)).toEqual({ max: 80, step: 20, ticks: [0, 20, 40, 60, 80] });
    expect(niceScale(16)).toEqual({ max: 20, step: 5, ticks: [0, 5, 10, 15, 20] });
  });

  it("keeps steps integer for small counts", () => {
    expect(niceScale(3)).toEqual({ max: 3, step: 1, ticks: [0, 1, 2, 3] });
  });

  it("guards a zero or negative max so the axis still renders", () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
    expect(niceScale(-5)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
  });
});

describe("statsForDay", () => {
  const charts = [
    {
      title: "Generation",
      series: [
        { label: "Batches", values: [0, 3, 58] },
        { label: "Photos", values: [0, 26, 870] },
      ],
    },
    {
      title: "Prints",
      series: [
        { label: "Requested", values: [0, 0, 6] },
        { label: "Completed", values: [0, 0, 6] },
      ],
    },
  ];

  it("returns every series across all charts at a day index", () => {
    expect(statsForDay(charts, 2)).toEqual([
      { chartTitle: "Generation", label: "Batches", value: 58, seriesIndex: 0 },
      { chartTitle: "Generation", label: "Photos", value: 870, seriesIndex: 1 },
      { chartTitle: "Prints", label: "Requested", value: 6, seriesIndex: 0 },
      { chartTitle: "Prints", label: "Completed", value: 6, seriesIndex: 1 },
    ]);
  });

  it("treats missing or short series as 0", () => {
    expect(statsForDay([{ title: "C", series: [{ label: "S", values: [1] }] }], 5)).toEqual([
      { chartTitle: "C", label: "S", value: 0, seriesIndex: 0 },
    ]);
  });
});
