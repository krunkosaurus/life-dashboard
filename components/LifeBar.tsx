"use client";
import { useEffect, useState } from "react";
import type { LifeConfig } from "@/lib/types";

const MS_PER_YEAR = 365.2425 * 86400 * 1000;

export function LifeBar({ life }: { life: LifeConfig }) {
  // Recompute once a minute — plenty for a value that moves ~0.003%/day.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const birth = Date.parse(life.birthDate);
  const lived = now - birth;
  const total = life.expectancyYears * MS_PER_YEAR;
  const pct = Math.min(100, Math.max(0, (lived / total) * 100));
  const age = Math.floor(lived / MS_PER_YEAR);
  const yearsLeft = Math.max(0, (total - lived) / MS_PER_YEAR);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "#9aa6b8" }}>
          Life · age {age} · ~{yearsLeft.toFixed(0)} yrs left
        </span>
        <span><strong>{pct.toFixed(1)}%</strong> complete</span>
      </div>
      <div style={{ background: "#0b0d10", height: 8, borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%", background: "#7aa2f7", transition: "width 400ms ease",
        }} />
      </div>
    </div>
  );
}
