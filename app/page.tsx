"use client";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { LimitGauge } from "@/components/LimitGauge";
import { CountdownCard } from "@/components/CountdownCard";
import { LifeBar } from "@/components/LifeBar";
import type { EventsResult, LifeConfig, UsageResult } from "@/lib/types";

const DEFAULT_REFRESH_MS = 60_000;
// Snapshots older than this are treated as stale and the gauges are dimmed
// with no reset countdown. One hour comfortably covers a few skipped runs
// without hiding ~current data.
const STALE_AFTER_S = 60 * 60;

function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

async function safeFetch<T>(url: string): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `request failed: ${(e as Error).message}` };
  }
}

export default function Page() {
  const [claude, setClaude] = useState<UsageResult | null>(null);
  const [codex, setCodex]   = useState<UsageResult | null>(null);
  const [events, setEvents] = useState<EventsResult | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [life, setLife] = useState<LifeConfig | null>(null);

  const refresh = useCallback(async () => {
    const [c, x, e] = await Promise.all([
      safeFetch<UsageResult>("/api/usage/claude"),
      safeFetch<UsageResult>("/api/usage/codex"),
      safeFetch<EventsResult>("/api/events"),
    ]);
    setClaude(c as UsageResult);
    setCodex(x as UsageResult);
    setEvents(e as EventsResult);
    setUpdated(Math.floor(Date.now() / 1000));
  }, []);

  // Honor the configured refreshSeconds (config.local.json). Fetched once on
  // mount; the polling effect below re-arms whenever the interval changes.
  useEffect(() => {
    safeFetch<{ refreshSeconds?: number; life?: LifeConfig | null }>("/api/config").then(cfg => {
      const secs = "refreshSeconds" in cfg ? cfg.refreshSeconds : undefined;
      if (typeof secs === "number" && Number.isFinite(secs) && secs > 0) {
        setRefreshMs(secs * 1000);
      }
      if ("life" in cfg && cfg.life) setLife(cfg.life);
    });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  const updatedAt =
    updated != null ? new Date(updated * 1000).toLocaleTimeString() : "—";

  return (
    <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Life Dashboard</h1>
        <div style={{ fontSize: 12, color: "#7a8595" }}>
          updated {updatedAt}{" "}
          <button onClick={refresh} style={{ marginLeft: 8, background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b", padding: "2px 8px", borderRadius: 6, cursor: "pointer" }}>
            refresh
          </button>
        </div>
      </header>

      {life && <LifeBar life={life} />}

      <div className="grid grid-2">
        <UsagePanel title="Claude Code" data={claude} />
        <UsagePanel title="Codex" data={codex} />
      </div>

      <section>
        <h2 style={{ margin: "0 0 12px", fontSize: 16, color: "#9aa6b8", fontWeight: 600 }}>Countdowns</h2>
        <EventsGrid data={events} />
      </section>
    </main>
  );
}

function UsagePanel({ title, data }: { title: string; data: UsageResult | null }) {
  if (!data) return <Panel title={title}><GaugeSkeleton /></Panel>;
  if (!data.ok) return <Panel title={title}><Unavailable reason={data.error} /></Panel>;
  const ageSec =
    data.snapshotAt != null
      ? Math.max(0, Math.floor(Date.now() / 1000 - data.snapshotAt))
      : null;
  const isStale = ageSec != null && ageSec > STALE_AFTER_S;
  const footer = ageSec == null ? null : isStale
    ? <span style={{ color: "#f59e0b" }}>stale · {formatAge(ageSec)} old</span>
    : `${formatAge(ageSec)} old`;
  return (
    <Panel title={title} footer={footer}>
      {isStale && (
        <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>
          Snapshot is {formatAge(ageSec)} old — run {title} to refresh.
        </p>
      )}
      <div style={{ opacity: isStale ? 0.4 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {data.windows.map(w => (
          <LimitGauge key={w.label} label={w.label} usedPercent={w.usedPercent} resetAt={w.resetAt} windowSecs={w.windowSecs} stale={isStale} />
        ))}
      </div>
    </Panel>
  );
}

function EventsGrid({ data }: { data: EventsResult | null }) {
  if (!data) return <EventsSkeleton />;
  if (!data.ok) return <Unavailable reason={data.error} />;
  if (data.events.length === 0) return <p style={{ color: "#7a8595", fontSize: 13 }}>No upcoming events.</p>;
  return (
    <div className="grid grid-3">
      {data.events.slice(0, 9).map(e => (
        <CountdownCard key={`${e.title}-${e.start}`} title={e.title} start={e.start} pinned={e.pinned} />
      ))}
    </div>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>Unavailable — {reason}</p>;
}

function GaugeSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div>
      <div className="skel-line" style={{ width: "60%", height: 12, marginBottom: 6 }} />
      <div className="skel-line" style={{ width: "100%", height: 8 }} />
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div className="grid grid-3">
      {[0, 1, 2].map(i => (
        <div key={i} style={{ background: "#11151b", border: "1px solid #1c222b", borderRadius: 12, padding: 16 }}>
          <div className="skel-line" style={{ width: "70%", height: 12, marginBottom: 10 }} />
          <div className="skel-line" style={{ width: "50%", height: 20 }} />
        </div>
      ))}
    </div>
  );
}
