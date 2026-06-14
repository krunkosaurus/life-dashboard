import type { AnalyticsChart } from "./types";

export type DayStat = {
  chartTitle: string;
  label: string;
  value: number;
  seriesIndex: number; // position within its chart, for color matching
};

// Gather every series' value (across all of a location's charts) at one day
// index — the full set of stats for that timeslice, for the hover tooltip.
// Missing or short series read as 0.
export function statsForDay(charts: AnalyticsChart[], i: number): DayStat[] {
  const out: DayStat[] = [];
  for (const chart of charts) {
    chart.series.forEach((s, seriesIndex) => {
      const v = s.values[i];
      out.push({
        chartTitle: chart.title,
        label: s.label,
        value: Number.isFinite(v) ? v : 0,
        seriesIndex,
      });
    });
  }
  return out;
}

// Compute a "nice" axis scale for integer counts: round the max up to a clean
// value and produce evenly-spaced integer ticks from 0. Used for the analytics
// line charts' Y axis.
export function niceScale(rawMax: number, desiredTicks = 5): { max: number; step: number; ticks: number[] } {
  const max = Math.max(0, rawMax);
  if (max <= 0) return { max: 1, step: 1, ticks: [0, 1] };

  const rawStep = max / desiredTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, Math.round(factor * mag)); // counts are integers

  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= niceMax; t += step) ticks.push(t);
  return { max: niceMax, step, ticks };
}
