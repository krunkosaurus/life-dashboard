"use client";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/countdown";
import { getMonthAccent } from "@/lib/monthColors";

export function CountdownCard({ title, start, pinned }: {
  title: string; start: number; pinned: boolean;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = start - now;
  const accent = getMonthAccent(new Date(start * 1000).getMonth());
  const when = new Date(start * 1000).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <article style={{
      background: "#11151b",
      border: `1px solid ${pinned ? accent.solid : accent.border}`,
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8,
      boxShadow: `inset 3px 0 0 ${accent.solid}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h3>
        {pinned && <span style={{ fontSize: 10, color: accent.text, letterSpacing: 1, flexShrink: 0 }}>PINNED</span>}
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 600, color: accent.solid, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
        {formatCountdown(remaining)}
      </div>
      <div style={{ fontSize: 12, color: accent.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{when}</div>
    </article>
  );
}
