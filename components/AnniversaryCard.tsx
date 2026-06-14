"use client";
import { useEffect, useState } from "react";
import { getMonthAccent } from "@/lib/monthColors";

function pad(n: number) {
  return n.toString().padStart(2, " ");
}

function parts(secs: number) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return { d, h, m, s };
}

// Decimal count of years since `sinceYear` as of now, e.g. 43.7. For a birthday
// that's the current age; for any other anniversary it's the years elapsed since
// the origin event (wedding, job start, …).
function yearsSinceDecimal(nextUnix: number, sinceYear: number, nowMs: number): number {
  const next = new Date(nextUnix * 1000);
  const nextMs = next.getTime();
  const last = new Date(
    next.getFullYear() - 1,
    next.getMonth(),
    next.getDate(),
    next.getHours(),
    0, 0
  );
  const fullYears = last.getFullYear() - sinceYear;
  const progress = (nowMs - last.getTime()) / (nextMs - last.getTime());
  return fullYears + Math.max(0, Math.min(1, progress));
}

export function AnniversaryCard({ title, start, sinceYear, type = "birthday" }: {
  title: string;
  start: number;            // next occurrence, unix seconds
  sinceYear?: number;       // origin year; when set, a years-since count is shown
  type?: "birthday" | "anniversary";
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, start - Math.floor(now / 1000));
  const { d, h, m, s } = parts(remaining);
  const accent = getMonthAccent(new Date(start * 1000).getMonth());
  const badge = type === "birthday" ? "BDAY" : "ANNIV";
  const count = sinceYear != null ? yearsSinceDecimal(start, sinceYear, now) : null;
  const when = new Date(start * 1000).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  return (
    <article style={{
      background: "#11151b",
      border: `1px solid ${accent.border}`,
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8,
      boxShadow: `inset 3px 0 0 ${accent.solid}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h3>
        <span style={{ fontSize: 10, color: accent.text, letterSpacing: 1, flexShrink: 0 }}>{badge}</span>
      </div>
      {count != null ? (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, color: accent.solid, letterSpacing: 0.5 }}>
            {count.toFixed(1)}
          </div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 600, color: accent.text, whiteSpace: "nowrap" }}>
            {d}d {pad(h)}h {pad(m)}m {pad(s)}s → {Math.floor(count) + 1}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 600, color: accent.solid, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
            {d}d {pad(h)}h {pad(m)}m {pad(s)}s
          </div>
          <div style={{ fontSize: 12, color: accent.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{when}</div>
        </>
      )}
    </article>
  );
}
