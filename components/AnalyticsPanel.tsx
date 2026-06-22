"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { niceScale, statsForDay } from "@/lib/chart";
import type { AnalyticsChart, AnalyticsLocation, AnalyticsResult } from "@/lib/types";

// Distinct, legible series colors (reused across charts by series index).
const SERIES_COLORS = ["#7aa2f7", "#34d399", "#f59e0b", "#a78bfa", "#ef4444"];

const PLOT_HEIGHT = 120; // px, the chart drawing area
const Y_AXIS_WIDTH = 38;  // px, room for count labels on the left

const fmt = (n: number) => n.toLocaleString();

function splitDayLabel(label: string): { date: string; weekday: string | null } {
  const match = label.match(/^(.+?)\s+-\s+([A-Za-z]{3})$/);
  if (!match) return { date: label, weekday: null };
  return { date: match[1], weekday: match[2] };
}

type HoverControls = {
  hoverI: number | null;
  setHoverI: (i: number | null) => void;
};

type AnalyticsPanelProps = {
  data: AnalyticsResult | null;
  weekOffset?: number;
  onWeekOffsetChange?: (offset: number) => void;
};

export function AnalyticsPanel({ data, weekOffset = 0, onWeekOffsetChange }: AnalyticsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Hide entirely when unconfigured or still loading — analytics is optional,
  // so an absent block shows nothing rather than an error (like other panels'
  // "omit to hide" behavior).
  if (!data || !data.ok) return null;

  const { title, days, locationLayout, locations } = data.analytics;
  const locationsInGrid = locationLayout === "grid";
  const range =
    days.length > 0
      ? days.length > 1
        ? `${days[0]} – ${days[days.length - 1]} · UTC`
        : `${days[0]} · UTC`
      : `${locations.length} location${locations.length === 1 ? "" : "s"}`;

  return (
    <Panel
      title={title}
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      footer={<span style={{ color: "#7a8595" }}>{range}</span>}
    >
      <WeekNavigator weekOffset={weekOffset} onChange={onWeekOffsetChange} />
      <LiveClock />
      <div
        className={locationsInGrid ? "grid grid-2" : undefined}
        style={locationsInGrid ? { gap: 20 } : { display: "flex", flexDirection: "column", gap: 20 }}
      >
        {locations.map(loc => (
          <LocationBlock key={loc.name} location={loc} days={days} />
        ))}
      </div>
    </Panel>
  );
}

function WeekNavigator({ weekOffset, onChange }: { weekOffset: number; onChange?: (offset: number) => void }) {
  if (!onChange) return null;
  const distance = Math.abs(weekOffset);
  const canGoForward = weekOffset < 0;
  const label =
    weekOffset === 0
      ? "Current 7 days"
      : `${distance} week${distance === 1 ? "" : "s"} back`;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <button onClick={() => onChange(weekOffset - 1)} aria-label="Previous week" style={weekNavBtnStyle}>‹</button>
      <div style={{ textAlign: "center", lineHeight: 1.3 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {weekOffset !== 0 && (
          <button onClick={() => onChange(0)} style={weekCurrentBtnStyle}>Current</button>
        )}
      </div>
      <button
        onClick={() => onChange(Math.min(0, weekOffset + 1))}
        aria-label="Next week"
        disabled={!canGoForward}
        style={{ ...weekNavBtnStyle, opacity: canGoForward ? 1 : 0.45, cursor: canGoForward ? "pointer" : "not-allowed" }}
      >
        ›
      </button>
    </div>
  );
}

// Day labels on the charts are UTC calendar days; this makes the offset between
// UTC and the viewer's local clock explicit and updates live.
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;

  const pad = (n: number) => n.toString().padStart(2, "0");
  const utc = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const local = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "−";
  const offH = Math.floor(Math.abs(offMin) / 60);
  const offM = Math.abs(offMin) % 60;
  const off = `UTC${sign}${offH}${offM ? `:${pad(offM)}` : ""}`;

  return (
    <div style={{ fontSize: 11, color: "#7a8595", marginBottom: 4 }}>
      Days shown in <strong style={{ color: "#9aa6b8" }}>UTC</strong>. Now{" "}
      <strong style={{ color: "#cdd5e1" }}>{utc}</strong> UTC ·{" "}
      <strong style={{ color: "#cdd5e1" }}>{local}</strong> local ({off})
    </div>
  );
}

function LocationBlock({ location, days }: { location: AnalyticsLocation; days: string[] }) {
  const [syncedHoverI, setSyncedHoverI] = useState<number | null>(null);
  const stackCharts = location.chartLayout === "vertical";
  const hoverControls = location.syncHover === true ? { hoverI: syncedHoverI, setHoverI: setSyncedHoverI } : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: 0.2 }}>{location.name}</h3>
        {location.url && (
          <a
            href={location.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: "#7aa2f7", textDecoration: "none" }}
          >
            source ↗
          </a>
        )}
      </div>
      {location.error ? (
        <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>Unavailable — {location.error}</p>
      ) : (
        <div
          className={stackCharts ? undefined : "grid grid-2"}
          style={stackCharts ? { display: "flex", flexDirection: "column", gap: 16 } : undefined}
        >
          {location.charts.map(chart => (
            <LineChart key={chart.title} chart={chart} days={days} hoverControls={hoverControls} />
          ))}
        </div>
      )}
    </div>
  );
}

function LineChart({ chart, days, hoverControls }: { chart: AnalyticsChart; days: string[]; hoverControls?: HoverControls }) {
  const n = Math.max(days.length, ...chart.series.map(s => s.values.length), 1);
  const rawMax = Math.max(0, ...chart.series.flatMap(s => s.values));
  const { max, ticks } = niceScale(rawMax);

  // Which day is hovered (drives the crosshair + combined tooltip). null = none.
  const [localHoverI, setLocalHoverI] = useState<number | null>(null);
  const hoverI = hoverControls ? hoverControls.hoverI : localHoverI;
  const setHoverI = hoverControls ? hoverControls.setHoverI : setLocalHoverI;

  // Coordinates in a 0–100 box (band-centered X so points sit above their day
  // label; Y inverted so 0 is at the bottom). The SVG stretches to fill width.
  const xOf = (i: number) => ((i + 0.5) / n) * 100;
  const yOf = (v: number) => 100 - (v / max) * 100;

  return (
    <div
      style={{
        background: "#0c1015",
        border: "1px solid #1c222b",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "#cdd5e1" }}>{chart.title}</span>

      {/* Plot: Y-axis count labels on the left, line area on the right. */}
      <div style={{ display: "flex" }}>
        <div style={{ position: "relative", width: Y_AXIS_WIDTH, height: PLOT_HEIGHT, flexShrink: 0 }}>
          {ticks.map(t => (
            <span
              key={t}
              style={{
                position: "absolute",
                right: 6,
                top: `${100 - (t / max) * 100}%`,
                transform: "translateY(-50%)",
                fontSize: 10,
                color: "#7a8595",
                lineHeight: 1,
              }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>

        <div
          style={{ position: "relative", flex: 1, height: PLOT_HEIGHT }}
          onMouseLeave={() => setHoverI(null)}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ display: "block", overflow: "visible" }}
          >
            {ticks.map(t => {
              const y = 100 - (t / max) * 100;
              return (
                <line key={t} x1="0" y1={y} x2="100" y2={y} stroke="#1c222b" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              );
            })}
            {hoverI != null && (
              <line
                x1={xOf(hoverI)}
                y1="0"
                x2={xOf(hoverI)}
                y2="100"
                stroke="#3a4458"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {chart.series.map((s, si) => (
              <polyline
                key={s.label}
                points={s.values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ")}
                fill="none"
                stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Point dots as HTML so they stay round; the hovered day's grow. */}
          {chart.series.map((s, si) =>
            s.values.map((v, i) => {
              const active = i === hoverI;
              const size = active ? 8 : 5;
              return (
                <div
                  key={`${s.label}-${i}`}
                  style={{
                    position: "absolute",
                    left: `${xOf(i)}%`,
                    top: `${yOf(v)}%`,
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    background: SERIES_COLORS[si % SERIES_COLORS.length],
                    border: active ? "1px solid #0c1015" : "none",
                    transform: "translate(-50%, -50%)",
                    transition: "width 120ms, height 120ms",
                  }}
                />
              );
            })
          )}

          {/* Invisible per-day hit bands drive the hover. */}
          {Array.from({ length: n }, (_, i) => (
            <div
              key={i}
              onMouseEnter={() => setHoverI(i)}
              style={{ position: "absolute", left: `${(i / n) * 100}%`, top: 0, width: `${100 / n}%`, height: "100%", cursor: "crosshair" }}
            />
          ))}

          {hoverI != null && (
            <DayTooltip chart={chart} dayLabel={days[hoverI] ?? `#${hoverI + 1}`} i={hoverI} x={xOf(hoverI)} frac={(hoverI + 0.5) / n} />
          )}
        </div>
      </div>

      {/* Day axis, aligned under the line area (offset past the Y-axis column). */}
      <div style={{ display: "flex", marginLeft: Y_AXIS_WIDTH }}>
        {Array.from({ length: n }, (_, i) => {
          const { date, weekday } = splitDayLabel(days[i] ?? "");
          const active = i === hoverI;
          return (
            <span
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 10,
                color: active ? "#cdd5e1" : "#7a8595",
                fontWeight: active ? 600 : 400,
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                lineHeight: 1.1,
              }}
            >
              <span>{date}</span>
              {weekday && <span style={{ fontSize: 9, color: active ? "#9aa6b8" : "#636d7d" }}>{weekday}</span>}
            </span>
          );
        })}
      </div>

      {/* Legend with totals over the window. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 2 }}>
        {chart.series.map((s, si) => {
          const total = s.values.reduce((a, b) => a + b, 0);
          return (
            <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9aa6b8" }}>
              <span style={{ width: 12, height: 2, borderRadius: 1, background: SERIES_COLORS[si % SERIES_COLORS.length], flexShrink: 0 }} />
              {s.label}
              <strong style={{ color: "#cdd5e1" }}>{fmt(total)}</strong>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Floating tooltip showing this chart's series values for one hovered day.
// Anchored to the day's x, flipping at the edges to stay in.
function DayTooltip({ chart, dayLabel, i, x, frac }: { chart: AnalyticsChart; dayLabel: string; i: number; x: number; frac: number }) {
  const rows = statsForDay([chart], i);
  const transform = frac < 0.33 ? "translateX(0)" : frac > 0.67 ? "translateX(-100%)" : "translateX(-50%)";
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: 2,
        transform,
        pointerEvents: "none",
        zIndex: 5,
        background: "#0b0d10",
        border: "1px solid #2a323f",
        borderRadius: 8,
        padding: "7px 10px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "#cdd5e1", marginBottom: 5 }}>{dayLabel}</div>
      {rows.map(r => (
        <div key={`${r.chartTitle}-${r.label}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, lineHeight: 1.6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_COLORS[r.seriesIndex % SERIES_COLORS.length], flexShrink: 0 }} />
          <span style={{ color: "#9aa6b8", flex: 1 }}>{r.label}</span>
          <strong style={{ color: "#e6e9ef", marginLeft: 12 }}>{fmt(r.value)}</strong>
        </div>
      ))}
    </div>
  );
}

const weekNavBtnStyle: React.CSSProperties = {
  background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b",
  width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 18, lineHeight: 1,
};

const weekCurrentBtnStyle: React.CSSProperties = {
  background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b",
  padding: "3px 9px", borderRadius: 8, cursor: "pointer", fontSize: 11, marginTop: 4,
};
