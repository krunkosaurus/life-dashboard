import { Panel } from "@/components/Panel";
import type { OuraResult } from "@/lib/types";
import type React from "react";

const cardStyle: React.CSSProperties = {
  background: "#0c1015",
  border: "1px solid #1c222b",
  borderRadius: 10,
  padding: "12px 14px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sleepWindow(start: string | null, end: string | null): string | null {
  const a = fmtTime(start);
  const b = fmtTime(end);
  return a && b ? `${a} - ${b}` : null;
}

function scoreText(score: number | null, label: string): string {
  return score == null ? `${label} score —` : `${label} score ${score}`;
}

function checkedFooter(checkedAt: number): string {
  return `checked ${new Date(checkedAt * 1000).toLocaleTimeString()}`;
}

function ymdInTimeZone(date: Date, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayForOffset(dayOffset: number, timeZone?: string): string {
  return addDaysYmd(ymdInTimeZone(new Date(), timeZone), Math.min(0, dayOffset));
}

function dayLabels(day: string, dayOffset: number): { rel: string; full: string } {
  const date = new Date(`${day}T00:00:00Z`);
  const full = Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : day;
  if (dayOffset === 0) return { rel: "Today", full };
  if (dayOffset === -1) return { rel: "Yesterday", full };
  const rel = Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })
    : `${Math.abs(dayOffset)} days back`;
  return { rel, full };
}

type OuraPanelProps = {
  data: OuraResult | null;
  loading?: boolean;
  dayOffset?: number;
  onDayOffsetChange?: (offset: number) => void;
};

export function OuraPanel({ data, loading = false, dayOffset = 0, onDayOffsetChange }: OuraPanelProps) {
  if (!data || (!data.ok && data.hidden)) return null;

  if (!data.ok) {
    return (
      <Panel title="Oura">
        <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>Unavailable — {data.error}</p>
        {data.connectUrl && (
          <a href={data.connectUrl} style={{ color: "#7aa2f7", fontSize: 13, textDecoration: "none" }}>
            Connect Oura
          </a>
        )}
      </Panel>
    );
  }

  const sleep = loading ? null : data.sleep;
  const activity = loading ? null : data.activity;
  const selectedDay = loading ? dayForOffset(dayOffset, data.timeZone) : data.day;
  const labels = dayLabels(selectedDay, dayOffset);
  const canGoForward = dayOffset < 0;
  const window = sleep ? sleepWindow(sleep.bedtimeStart, sleep.bedtimeEnd) : null;
  const activitySub = activity
    ? [
        scoreText(activity.score, "Activity"),
        activity.activeCalories == null ? null : `${fmtInt(activity.activeCalories)} active cal`,
      ].filter(Boolean).join(" · ")
    : "No activity data yet";

  return (
    <Panel title="Oura" footer={loading ? "updating" : checkedFooter(data.checkedAt)}>
      {onDayOffsetChange && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button onClick={() => onDayOffsetChange(dayOffset - 1)} aria-label="Previous day" style={navBtnStyle}>‹</button>
          <div style={{ textAlign: "center", lineHeight: 1.3 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{labels.rel}</div>
            <div style={{ fontSize: 11, color: "#7a8595" }}>{labels.full}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {dayOffset !== 0 && (
              <button onClick={() => onDayOffsetChange(0)} style={todayBtnStyle}>Today</button>
            )}
            <button
              onClick={() => onDayOffsetChange(Math.min(0, dayOffset + 1))}
              aria-label="Next day"
              disabled={!canGoForward}
              style={{ ...navBtnStyle, opacity: canGoForward ? 1 : 0.45, cursor: canGoForward ? "pointer" : "not-allowed" }}
            >
              ›
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-2">
        <div style={cardStyle}>
          <span style={{ color: "#7a8595", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>
            Sleep
          </span>
          <strong style={{ fontSize: 28, lineHeight: 1, fontWeight: 650 }}>
            {loading ? "—" : sleep ? fmtDuration(sleep.totalSleepSeconds) : "—"}
          </strong>
          <div style={{ color: "#9aa6b8", fontSize: 12, lineHeight: 1.4 }}>
            {loading ? "Updating..." : sleep ? scoreText(sleep.score, "Sleep") : "No sleep data yet"}
            {window && <span> · {window}</span>}
          </div>
          {loading ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#7a8595", fontSize: 11 }}>
              <span>Deep —</span>
              <span>REM —</span>
              <span>Efficiency —</span>
            </div>
          ) : sleep && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#7a8595", fontSize: 11 }}>
              <span>Deep {fmtDuration(sleep.deepSleepSeconds)}</span>
              <span>REM {fmtDuration(sleep.remSleepSeconds)}</span>
              {sleep.efficiency != null && <span>Efficiency {sleep.efficiency}%</span>}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <span style={{ color: "#7a8595", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>
            Activity
          </span>
          <strong style={{ fontSize: 28, lineHeight: 1, fontWeight: 650 }}>
            {loading ? "—" : activity ? fmtInt(activity.steps) : "—"}
          </strong>
          <div style={{ color: "#9aa6b8", fontSize: 12, lineHeight: 1.4 }}>
            {loading ? "Updating..." : activity ? "steps" : activitySub}
            {activity && <span> · {activitySub}</span>}
          </div>
          {activity?.targetCalories != null && (
            <div style={{ color: "#7a8595", fontSize: 11 }}>
              Target {fmtInt(activity.targetCalories)} cal
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b",
  width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 18, lineHeight: 1,
};

const todayBtnStyle: React.CSSProperties = {
  background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b",
  padding: "4px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12,
};
