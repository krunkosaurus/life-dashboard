"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { isDueOn, weekStartDateOf, ymd } from "@/lib/checklists";
import type { ChecklistItem, ChecklistResult, ChecklistState } from "@/lib/checklists";

const DAY_MS = 86_400_000;

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// Apply one toggle to a state, returning a fresh object (optimistic update +
// the local mirror of the server's read-modify-write). Empty buckets are pruned
// so reads stay clean.
function withToggle(
  base: ChecklistState,
  scope: "day" | "week",
  key: string,
  id: string,
  value: boolean
): ChecklistState {
  const next: ChecklistState = { version: base.version, days: { ...base.days }, weeks: { ...base.weeks } };
  const buckets = scope === "week" ? next.weeks : next.days;
  const bucket = { ...(buckets[key] ?? {}) };
  if (value) bucket[id] = true;
  else delete bucket[id];
  if (Object.keys(bucket).length > 0) buckets[key] = bucket;
  else delete buckets[key];
  return next;
}

export function ChecklistPanel({ data }: { data: ChecklistResult | null }) {
  const [viewed, setViewed] = useState<Date>(startOfToday);
  const [collapsed, setCollapsed] = useState(false);
  const [liveState, setLiveState] = useState<ChecklistState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the local overlay whenever a fresh fetch lands (also picks up edits
  // made on another device).
  useEffect(() => {
    if (data?.ok) setLiveState(data.state);
  }, [data]);

  // Not configured (or first load before data) → render nothing, like AnalyticsPanel.
  if (!data || !data.ok) return null;
  const { checklist } = data;
  const state = liveState ?? data.state;

  const dateKey = ymd(viewed);
  const weekKey = weekStartDateOf(viewed, checklist.weekStart);
  const dayMap = state.days[dateKey] ?? {};
  const weekMap = state.weeks[weekKey] ?? {};
  const isChecked = (it: ChecklistItem) => (it.repeat === "weekly" ? !!weekMap[it.id] : !!dayMap[it.id]);

  const today = startOfToday();
  const diffDays = Math.round((viewed.getTime() - today.getTime()) / DAY_MS);
  const isToday = diffDays === 0;
  const relLabel =
    diffDays === 0 ? "Today"
    : diffDays === -1 ? "Yesterday"
    : diffDays === 1 ? "Tomorrow"
    : viewed.toLocaleDateString(undefined, { weekday: "long" });
  const fullLabel = viewed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // Counts over what's actually due on the viewed day.
  let total = 0;
  let done = 0;
  for (const g of checklist.groups) {
    for (const it of g.items) {
      if (!isDueOn(it, viewed)) continue;
      total++;
      if (isChecked(it)) done++;
    }
  }
  const allDone = total > 0 && done === total;
  const footer =
    total === 0 ? <span style={{ color: "#7a8595" }}>nothing scheduled</span>
    : <span style={{ color: allDone ? "#34d399" : "#7a8595" }}>{done} / {total} done</span>;

  const shift = (days: number) => setViewed(new Date(viewed.getTime() + days * DAY_MS));

  async function toggle(it: ChecklistItem) {
    const weekly = it.repeat === "weekly";
    const scope: "day" | "week" = weekly ? "week" : "day";
    const key = weekly ? weekKey : dateKey;
    const next = !isChecked(it);
    const prev = state;

    setError(null);
    setLiveState(withToggle(prev, scope, key, it.id, next));
    try {
      const res = await fetch("/api/checklists/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, key, id: it.id, value: next }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "save failed");
    } catch {
      setLiveState(prev); // revert
      setError("Couldn't save — try again.");
    }
  }

  return (
    <Panel
      title={checklist.title}
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      footer={footer}
    >
      {/* Date navigator */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button onClick={() => shift(-1)} aria-label="Previous day" style={navBtnStyle}>‹</button>
        <div style={{ textAlign: "center", lineHeight: 1.3 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{relLabel}</div>
          <div style={{ fontSize: 11, color: "#7a8595" }}>{fullLabel}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!isToday && (
            <button onClick={() => setViewed(startOfToday())} style={todayBtnStyle}>Today</button>
          )}
          <button onClick={() => shift(1)} aria-label="Next day" style={navBtnStyle}>›</button>
        </div>
      </div>

      {error && <p style={{ color: "#f59e0b", fontSize: 12, margin: 0 }}>{error}</p>}

      {total === 0 ? (
        <p style={{ color: "#7a8595", fontSize: 13, margin: 0 }}>Nothing scheduled for this day.</p>
      ) : (
        // Groups laid out as side-by-side columns to save vertical space. Every
        // group renders (incl. ones with no due items, e.g. an empty Weekly
        // column) so the column layout stays stable day to day.
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "start" }}>
          {checklist.groups.map((group) => {
            const due = group.items.filter((it) => isDueOn(it, viewed));
            return (
              <div key={group.name || "__ungrouped"} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#7a8595", minHeight: 13 }}>
                  {group.name || " "}
                </div>
                {due.map((it) => (
                  <ChecklistRow key={it.id} item={it} checked={isChecked(it)} onToggle={() => toggle(it)} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ChecklistRow({ item, checked, onToggle }: {
  item: ChecklistItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "7px 10px", background: "#0c1015", border: "1px solid #1c222b", borderRadius: 8,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ width: 16, height: 16, accentColor: "#34d399", cursor: "pointer", flexShrink: 0 }}
      />
      <span style={{
        fontSize: 13, flex: 1, minWidth: 0,
        color: checked ? "#7a8595" : "#e6e9ef",
        textDecoration: checked ? "line-through" : "none",
      }}>
        {item.label}
      </span>
    </label>
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
