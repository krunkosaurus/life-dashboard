"use client";

import { useEffect, useRef, useState } from "react";
import type { ClimatePoint, ClimateSensor } from "@/lib/climateTypes";

const HEIGHT = 190;
const LEFT = 35;
const TOP = 12;
const BOTTOM = HEIGHT - 28;
const COLORS = ["#7aa2f7", "#f3b36b", "#63cbb5", "#c19cf3"];

function lineSegments(points: ClimatePoint[], x: (ts: number) => number, y: (temperature: number) => number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (index > 0 && point.ts - points[index - 1].ts > 15 * 60) {
      segments.push(current.join(" ")); current = [];
    }
    current.push(`${x(point.ts)},${y(point.temperatureF)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}

export function ClimateChart({ sensors, checkedAt, timeZone, location }: {
  sensors: ClimateSensor[]; checkedAt: number; timeZone: string; location: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(620);
  const container = useRef<HTMLDivElement>(null);
  const start = checkedAt - 24 * 3600;
  const series = sensors.map(sensor => ({ ...sensor, points: sensor.history.filter(p => p.ts >= start && p.ts <= checkedAt) }));
  const values = series.flatMap(sensor => sensor.points.map(point => point.temperatureF));
  const hasHistory = values.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasHistory]);
  const right = width - 12;
  if (!values.length) return <div className="climate-chart-empty">Temperature history will appear as readings arrive.</div>;
  const min = Math.floor((Math.min(...values) - 2) / 2) * 2;
  const max = Math.ceil((Math.max(...values) + 2) / 2) * 2;
  const x = (ts: number) => LEFT + ((ts - start) / (checkedAt - start)) * (right - LEFT);
  const y = (value: number) => BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP);
  const time = (ts: number) => new Intl.DateTimeFormat("en-SG", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts * 1000));
  const dateTime = (ts: number) => new Intl.DateTimeFormat("en-SG", { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts * 1000));
  const axisTime = (ts: number, index: number) => index === 1 ? time(ts) : dateTime(ts);
  const selected = hover == null ? null : series.map(sensor => {
    let nearest: ClimatePoint | null = null;
    for (const point of sensor.points) if (!nearest || Math.abs(point.ts - hover) < Math.abs(nearest.ts - hover)) nearest = point;
    return nearest && Math.abs(nearest.ts - hover) <= 10 * 60 ? nearest : null;
  });
  return (
    <div className="climate-chart">
      <div className="climate-chart-heading"><span>Temperature · past 24 hours</span><span>°F</span></div>
      <div ref={container} className="climate-chart-plot" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`${location} temperature history over the past 24 hours`}
          onPointerMove={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const position = Math.max(LEFT, Math.min(right, ((event.clientX - rect.left) / rect.width) * width));
            setHover(start + ((position - LEFT) / (right - LEFT)) * (checkedAt - start));
          }}>
          {[0, 1, 2, 3].map(index => {
            const value = min + (index / 3) * (max - min);
            return <g key={index}><line x1={LEFT} x2={right} y1={y(value)} y2={y(value)} stroke="#242c38" strokeDasharray="3 5" />
              <text x={LEFT - 8} y={y(value) + 3} textAnchor="end" fill="#7a8595" fontSize="10">{Math.round(value)}°</text></g>;
          })}
          {series.map((sensor, index) => <g key={sensor.id}>
            {lineSegments(sensor.points, x, y).map((points, segment) => <polyline key={segment} points={points} fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
            {sensor.points.length > 0 && <circle cx={x(sensor.points.at(-1)!.ts)} cy={y(sensor.points.at(-1)!.temperatureF)} r="3" fill={COLORS[index % COLORS.length]} />}
          </g>)}
          {[start, start + 12 * 3600, checkedAt].map((ts, index) => <text key={ts} x={x(ts)} y={HEIGHT - 6} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} fill="#7a8595" fontSize="10">{axisTime(ts, index)}</text>)}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="#8996ac" strokeDasharray="3 3" />}
          {selected?.map((point, index) => point && <circle key={series[index].id} cx={x(point.ts)} cy={y(point.temperatureF)} r="4" fill={COLORS[index % COLORS.length]} stroke="#11151b" strokeWidth="2" />)}
        </svg>
        {hover != null && <div className="climate-chart-tooltip">
          <span>{dateTime(hover)}</span>
          {series.map((sensor, index) => <div key={sensor.id}><i style={{ background: COLORS[index % COLORS.length] }} />{sensor.label}<strong>{selected?.[index]?.temperatureF.toFixed(1) ?? "—"}°F</strong></div>)}
        </div>}
      </div>
      <div className="climate-chart-legend">{series.map((sensor, index) => <span key={sensor.id}><i style={{ background: COLORS[index % COLORS.length] }} />{sensor.label}</span>)}</div>
    </div>
  );
}
