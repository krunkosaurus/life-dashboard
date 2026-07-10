"use client";
import { useEffect, useState } from "react";

function colorFor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#22c55e";
}

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "expired";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function LimitGauge({ label, usedPercent, resetAt, windowSecs, stale = false }: {
  label: string; usedPercent: number; resetAt?: number; windowSecs?: number; stale?: boolean;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    // Stale gauges and windows without a scheduled reset don't need a
    // per-second tick (the reset timer is hidden).
    if (stale || resetAt == null) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [stale, resetAt]);
  const remaining = resetAt == null ? null : Math.max(0, resetAt - now);
  const color = colorFor(usedPercent);
  // Time elapsed in the window, as a percent. Clamped: a passed resetAt reads
  // 100%, clock skew (remaining > windowSecs) reads 0%. Null when the window
  // duration is unknown (old snapshots) — then no elapsed bar is drawn.
  const elapsedPercent = windowSecs && remaining != null
    ? Math.min(100, Math.max(0, ((windowSecs - remaining) / windowSecs) * 100))
    : null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "#9aa6b8" }}>{label}</span>
        <span>
          <strong>{usedPercent.toFixed(0)}%</strong>
          {!stale && remaining != null && <> · resets in {fmtCountdown(remaining)}</>}
          {!stale && remaining == null && <> · no reset scheduled</>}
        </span>
      </div>
      <div style={{
        background: "#0b0d10", height: 8, overflow: "hidden",
        borderRadius: elapsedPercent != null ? "4px 4px 0 0" : 4,
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
          height: "100%", background: color, transition: "width 400ms ease",
        }} />
      </div>
      {elapsedPercent != null && (
        <div style={{
          background: "#0b0d10", height: 4, borderRadius: "0 0 4px 4px",
          overflow: "hidden", marginTop: 2,
        }}>
          <div style={{
            width: `${elapsedPercent}%`,
            height: "100%", background: "#eab308", transition: "width 1s linear",
          }} />
        </div>
      )}
    </div>
  );
}
