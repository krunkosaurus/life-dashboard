"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import type { LiveLogEvent, LiveLogResult, UsageFailure } from "@/lib/types";

// Compact age for feed rows: "now", "4m", "3h", "2d".
function shortAge(secs: number): string {
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

// Local-timezone day bucket label for separators.
function dayLabel(timeS: number, now: Date): string {
  const d = new Date(timeS * 1000);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${date} · ${weekday}`;
}

export function LiveLogPanel({ data }: { data: LiveLogResult | null }) {
  const [collapsed, setCollapsed] = useState(false);

  if (data && !data.ok && "hidden" in data && data.hidden) return null; // not configured
  if (!data) {
    return (
      <Panel title="Live Log">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="skel-line" style={{ width: "40%", height: 12 }} />
          <div className="skel-line" style={{ width: "100%", height: 10 }} />
          <div className="skel-line" style={{ width: "90%", height: 10 }} />
          <div className="skel-line" style={{ width: "95%", height: 10 }} />
        </div>
      </Panel>
    );
  }
  if (!data.ok) {
    return (
      <Panel title="Live Log">
        <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>Unavailable — {data.error}</p>
        <FailureLog failures={data.failures} />
      </Panel>
    );
  }

  const now = new Date();
  const checked = new Date(data.checkedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const footer = data.stale ? (
    <span style={{ color: "#f59e0b" }} title={data.staleReason}>
      {data.events.length} events · stale · checked {checked}
    </span>
  ) : (
    <span>
      {data.events.length} events · {data.windowHours}h · checked {checked}
    </span>
  );

  return (
    <Panel title={data.title} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} footer={footer}>
      {data.stats.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 8 }}>
          {data.stats.map((s, i) => (
            <div
              key={`${s.label}-${i}`}
              style={{ background: "#0c1015", border: "1px solid #1c222b", borderRadius: 8, padding: "8px 10px" }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: s.value === "—" ? "#7a8595" : "#e6e9ef" }}>
                {s.value}
              </div>
              <div style={{ fontSize: 10, color: "#7a8595", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.sourceErrors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.sourceErrors.map(err => (
            <div key={err.id} style={{ color: "#f59e0b", fontSize: 12 }}>
              ⚠ {err.label} — {err.error}
            </div>
          ))}
        </div>
      )}

      <div style={{ opacity: data.stale ? 0.75 : 1, maxHeight: 440, overflowY: "auto", paddingRight: 4 }}>
        {data.events.length === 0 ? (
          <p style={{ color: "#7a8595", fontSize: 13, margin: 0 }}>No events in the last {data.windowHours}h.</p>
        ) : (
          <EventList events={data.events} now={now} />
        )}
      </div>

      <FailureLog failures={data.failures} />
    </Panel>
  );
}

function EventList({ events, now }: { events: LiveLogEvent[]; now: Date }) {
  const nowS = Math.floor(now.getTime() / 1000);
  let lastDay: string | null = null;
  const rows: React.ReactNode[] = [];
  for (const e of events) {
    const day = dayLabel(e.time, now);
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <div
          key={`day-${day}`}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 6px", color: "#7a8595" }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {day}
          </span>
          <span style={{ flex: 1, height: 1, background: "#1c222b" }} />
        </div>
      );
    }
    rows.push(<EventRow key={e.id} event={e} nowS={nowS} />);
  }
  return <div style={{ display: "flex", flexDirection: "column" }}>{rows}</div>;
}

function EventRow({ event: e, nowS }: { event: LiveLogEvent; nowS: number }) {
  const clock = new Date(e.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", minWidth: 0 }}>
      <span
        style={{ width: 62, flexShrink: 0, fontSize: 11, color: "#7a8595", fontVariantNumeric: "tabular-nums", textAlign: "right" }}
        title={`${shortAge(Math.max(0, nowS - e.time))} ago`}
      >
        {clock}
      </span>
      <span
        style={{ width: 7, height: 7, borderRadius: "50%", background: e.color, flexShrink: 0, alignSelf: "center" }}
      />
      <span style={{ width: 88, flexShrink: 0, fontSize: 11, fontWeight: 600, color: e.color }}>{e.label}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e6e9ef", overflowWrap: "anywhere" }}>{e.title}</span>
        {e.badges.map((b, i) => (
          <span
            key={`${b.text}-${i}`}
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              background: "#1c222b",
              border: "1px solid #2a323f",
              color: b.color ?? "#9aa6b8",
              whiteSpace: "nowrap",
            }}
          >
            {b.text}
          </span>
        ))}
        {e.detail && (
          <span style={{ fontSize: 11, color: "#7a8595", overflowWrap: "anywhere" }}>{e.detail}</span>
        )}
      </span>
      {e.value && (
        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#cdd5e1" }}>{e.value}</span>
      )}
    </div>
  );
}

// Same collapsed failure history used by the usage panels.
function FailureLog({ failures }: { failures?: UsageFailure[] }) {
  if (!failures || failures.length === 0) return null;
  const now = Math.floor(Date.now() / 1000);
  const count = failures.reduce((sum, f) => sum + f.count, 0);
  return (
    <details style={{ fontSize: 12, color: "#7a8595" }}>
      <summary style={{ cursor: "pointer", userSelect: "none" }}>
        ⚠ {count} recent fetch error{count === 1 ? "" : "s"}
      </summary>
      <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {[...failures].reverse().map(f => (
          <li key={`${f.at}-${f.message}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ color: "#9aa6b8", whiteSpace: "nowrap" }}>
              {shortAge(Math.max(0, now - f.at))} ago{f.count > 1 ? ` ×${f.count}` : ""}
            </span>
            <span style={{ wordBreak: "break-word" }}>{f.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
