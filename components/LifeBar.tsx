"use client";
import { useEffect, useState } from "react";
import { MONTHS, getMonthAccent } from "@/lib/monthColors";
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
  const today = new Date(now);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const yearStart = new Date(currentYear, 0, 1).getTime();
  const yearEnd = new Date(currentYear + 1, 0, 1).getTime();
  const monthStart = new Date(currentYear, currentMonth, 1).getTime();
  const monthEnd = new Date(currentYear, currentMonth + 1, 1).getTime();
  const yearPct = Math.min(100, Math.max(0, ((now - yearStart) / (yearEnd - yearStart)) * 100));
  const monthPct = Math.min(100, Math.max(0, ((now - monthStart) / (monthEnd - monthStart)) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: "#9aa6b8" }}>
            Year · {MONTHS[currentMonth]} {currentYear}
          </span>
          <span style={{ textAlign: "right" }}>
            <strong>{monthPct.toFixed(0)}%</strong> → month{" "}
            <strong>{yearPct.toFixed(1)}%</strong> → year
          </span>
        </div>
        <div
          aria-label={`${currentYear} progress by month`}
          style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 2 }}
        >
          {MONTHS.map((month, index) => {
            const isPast = index < currentMonth;
            const isCurrent = index === currentMonth;
            const accent = getMonthAccent(index);
            return (
              <div
                key={month}
                title={`${month}${isCurrent ? ` · ${monthPct.toFixed(1)}% complete` : ""}`}
                aria-current={isCurrent ? "date" : undefined}
                style={{
                  height: 10,
                  background: isPast ? accent.solid : isCurrent ? accent.surface : accent.soft,
                  border: `1px solid ${isCurrent ? accent.solid : accent.border}`,
                  borderRadius: index === 0 ? "5px 2px 2px 5px" : index === 11 ? "2px 5px 5px 2px" : 2,
                  overflow: "hidden",
                  opacity: isPast || isCurrent ? 1 : 0.55,
                  boxShadow: isCurrent ? `0 0 0 1px ${accent.border}` : "none",
                }}
              >
                {isCurrent && (
                  <div
                    style={{
                      width: `${monthPct}%`,
                      height: "100%",
                      background: accent.solid,
                      transition: "width 400ms ease",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
