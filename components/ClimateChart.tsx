"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { endLabelOffsets, temperatureTicks } from "@/lib/climateChart";
import type { ClimatePoint } from "@/lib/climateTypes";

// One line per sensor, named after the room it measures and drawn in the same
// color as that sensor's card above the chart.
export type ChartSeries = { id: string; name: string; color: string; points: ClimatePoint[] };

const HEIGHT = 210;
const LEFT = 34;
const TOP = 18;
const BOTTOM = HEIGHT - 26;
const GAP_SECONDS = 15 * 60;
const SURFACE = "#11151b";

function lineSegments(points: ClimatePoint[], x: (ts: number) => number, y: (temperature: number) => number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (index > 0 && point.ts - points[index - 1].ts > GAP_SECONDS) {
      segments.push(current.join(" ")); current = [];
    }
    current.push(`${x(point.ts)},${y(point.temperatureF)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}

export function ClimateChart({ series: allSeries, checkedAt, timeZone, location }: {
  series: ChartSeries[]; checkedAt: number; timeZone: string; location: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(620);
  const container = useRef<HTMLDivElement>(null);
  const start = checkedAt - 24 * 3600;
  const series = allSeries.map(line => ({ ...line, points: line.points.filter(p => p.ts >= start && p.ts <= checkedAt) }));
  const values = series.flatMap(line => line.points.map(point => point.temperatureF));
  const hasHistory = values.length > 0;
  const formats = useMemo(() => ({
    clock: new Intl.DateTimeFormat("en-SG", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    day: new Intl.DateTimeFormat("en-SG", { timeZone, day: "numeric", month: "short" }),
    full: new Intl.DateTimeFormat("en-SG", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  }), [timeZone]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasHistory]);

  const legend = <ul className="climate-chart-legend" aria-label="Chart key">
    {series.map(line => <li key={line.id}><i style={{ background: line.color }} />{line.name}</li>)}
  </ul>;
  if (!hasHistory) return (
    <div className="climate-chart">
      <div className="climate-chart-heading"><h3>Last 24 hours</h3>{legend}</div>
      <p className="climate-chart-empty">No temperature history yet. The chart fills in as readings arrive.</p>
    </div>
  );

  const right = width - 8;
  const ticks = temperatureTicks(Math.min(...values), Math.max(...values));
  const min = ticks[0];
  const max = ticks.at(-1)!;
  const x = (ts: number) => LEFT + ((ts - start) / (checkedAt - start)) * (right - LEFT);
  const y = (value: number) => BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP);

  // Time ticks every six hours on the local clock; midnight shows the date instead.
  const timeTicks: { ts: number; label: string }[] = [];
  for (let ts = Math.ceil(start / 900) * 900; ts <= checkedAt; ts += 900) {
    const [hour, minute] = formats.clock.format(new Date(ts * 1000)).split(":").map(Number);
    if (minute !== 0 || hour % 6 !== 0) continue;
    if (x(ts) - LEFT < 22 || right - x(ts) < 22) continue;
    timeTicks.push({ ts, label: hour === 0 ? formats.day.format(new Date(ts * 1000)) : `${String(hour).padStart(2, "0")}:00` });
  }

  const ends = series.map(line => line.points.at(-1) ?? null);
  const offsets = endLabelOffsets(ends.map(point => point ? y(point.temperatureF) : BOTTOM));
  const selected = hover == null ? null : series.map(line => {
    let nearest: ClimatePoint | null = null;
    for (const point of line.points) if (!nearest || Math.abs(point.ts - hover) < Math.abs(nearest.ts - hover)) nearest = point;
    return nearest && Math.abs(nearest.ts - hover) <= 10 * 60 ? nearest : null;
  });
  const hoverShare = hover == null ? 0 : x(hover) / width;
  const tooltipSide = hoverShare > 0.55
    ? { right: `calc(${(1 - hoverShare) * 100}% + 12px)` }
    : { left: `calc(${hoverShare * 100}% + 12px)` };

  return (
    <div className="climate-chart">
      <div className="climate-chart-heading"><h3>Last 24 hours</h3>{legend}</div>
      <div ref={container} className="climate-chart-plot" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
          aria-label={`${location} temperatures over the last 24 hours: ${series.map((line, index) => `${line.name} ${ends[index] ? `${ends[index]!.temperatureF.toFixed(1)}°F now` : "no data"}`).join(", ")}`}
          onPointerMove={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const position = Math.max(LEFT, Math.min(right, ((event.clientX - rect.left) / rect.width) * width));
            setHover(start + ((position - LEFT) / (right - LEFT)) * (checkedAt - start));
          }}>
          {ticks.map(value => <g key={value}>
            <line x1={LEFT} x2={right} y1={y(value)} y2={y(value)} stroke="#1f2733" />
            <text x={LEFT - 8} y={y(value) + 4} textAnchor="end" className="climate-chart-axis">{value}°</text>
          </g>)}
          {timeTicks.map(tick => <text key={tick.ts} x={x(tick.ts)} y={HEIGHT - 6} textAnchor="middle" className="climate-chart-axis">{tick.label}</text>)}
          {series.map((line, index) => <g key={line.id}>
            {lineSegments(line.points, x, y).map((points, segment) =>
              <polyline key={segment} points={points} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
            {ends[index] && <circle cx={x(ends[index]!.ts)} cy={y(ends[index]!.temperatureF)} r="4" fill={line.color} stroke={SURFACE} strokeWidth="2" />}
          </g>)}
          {hover == null && series.map((line, index) => ends[index] &&
            <text key={line.id} x={right} y={Math.min(BOTTOM - 4, y(ends[index]!.temperatureF) + offsets[index])} textAnchor="end"
              className="climate-chart-end-label" stroke={SURFACE} strokeWidth="4" paintOrder="stroke">{line.name}</text>)}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="#5d6b80" strokeDasharray="3 3" />}
          {selected?.map((point, index) => point && <circle key={series[index].id} cx={x(point.ts)} cy={y(point.temperatureF)} r="4.5" fill={series[index].color} stroke={SURFACE} strokeWidth="2" />)}
        </svg>
        {hover != null && <div className="climate-chart-tooltip" style={tooltipSide}>
          <span>{formats.full.format(new Date(hover * 1000))}</span>
          {series.map((line, index) => <div key={line.id}><i style={{ background: line.color }} />{line.name}<strong>{selected?.[index] ? `${selected[index]!.temperatureF.toFixed(1)}°F` : "—"}</strong></div>)}
        </div>}
      </div>
    </div>
  );
}
