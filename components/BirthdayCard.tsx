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

// Returns current age as a decimal, e.g. 43.7
function ageDecimal(nextBirthdayUnix: number, birthYear: number, nowMs: number): number {
  const nextBday = new Date(nextBirthdayUnix * 1000);
  const nextBdayMs = nextBday.getTime();
  const lastBday = new Date(
    nextBday.getFullYear() - 1,
    nextBday.getMonth(),
    nextBday.getDate(),
    nextBday.getHours(),
    0, 0
  );
  const fullYears = lastBday.getFullYear() - birthYear;
  const progress = (nowMs - lastBday.getTime()) / (nextBdayMs - lastBday.getTime());
  return fullYears + Math.max(0, Math.min(1, progress));
}

export function BirthdayCard({ title, start, birthYear }: {
  title: string;
  start: number;       // next birthday unix seconds
  birthYear: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, start - Math.floor(now / 1000));
  const { d, h, m, s } = parts(remaining);
  const age = ageDecimal(start, birthYear, now);
  const nextAge = Math.floor(age) + 1;
  const accent = getMonthAccent(new Date(start * 1000).getMonth());

  return (
    <article style={{
      background: "#11151b",
      border: `1px solid ${accent.border}`,
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8,
      boxShadow: `inset 3px 0 0 ${accent.solid}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h3>
        <span style={{ fontSize: 10, color: accent.text, letterSpacing: 1, flexShrink: 0 }}>BDAY</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent.solid, letterSpacing: 0.5 }}>
        {age.toFixed(1)}
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 600, color: accent.text, whiteSpace: "nowrap" }}>
        {d}d {pad(h)}h {pad(m)}m {pad(s)}s → {nextAge}
      </div>
    </article>
  );
}
