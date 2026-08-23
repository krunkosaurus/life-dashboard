"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/Panel";
import { LimitGauge } from "@/components/LimitGauge";
import { CountdownCard } from "@/components/CountdownCard";
import { AnniversaryCard } from "@/components/AnniversaryCard";
import { LifeBar } from "@/components/LifeBar";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { ChecklistPanel } from "@/components/ChecklistPanel";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { OuraPanel } from "@/components/OuraPanel";
import { byPinnedThenMilestone, byPinnedThenSoonest, isAnniversaryEvent } from "@/lib/eventSort";
import type { ChecklistResult } from "@/lib/checklists";
import type { AnalyticsResult, BankedResetSummary, EventItem, EventsResult, LifeConfig, LiveLogResult, OuraResult, ServersResult, ServerStatus, UsageFailure, UsageResult } from "@/lib/types";

const DEFAULT_REFRESH_MS = 60_000;
// Each event panel renders at most this many cards (a clean 3×3 grid). The
// footer reflects the cap ("9 of 12") so the count never overstates what's shown.
const MAX_EVENT_CARDS = 9;
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
  const [servers, setServers] = useState<ServersResult | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [analyticsWeekOffset, setAnalyticsWeekOffset] = useState(0);
  const [checklists, setChecklists] = useState<ChecklistResult | null>(null);
  const [liveLog, setLiveLog] = useState<LiveLogResult | null>(null);
  const [oura, setOura] = useState<OuraResult | null>(null);
  const [ouraDayOffset, setOuraDayOffset] = useState(0);
  const [ouraLoading, setOuraLoading] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  const [refreshMs, setRefreshMs] = useState(DEFAULT_REFRESH_MS);
  const [life, setLife] = useState<LifeConfig | null>(null);
  const ouraRequestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const analyticsUrl = analyticsWeekOffset === 0
      ? "/api/analytics"
      : `/api/analytics?weekOffset=${analyticsWeekOffset}`;
    const ouraUrl = ouraDayOffset === 0
      ? "/api/oura"
      : `/api/oura?dayOffset=${ouraDayOffset}`;
    const ouraRequest = ++ouraRequestSeq.current;
    const [c, x, e, s, a, cl, ll, o] = await Promise.all([
      safeFetch<UsageResult>("/api/usage/claude"),
      safeFetch<UsageResult>("/api/usage/codex"),
      safeFetch<EventsResult>("/api/events"),
      safeFetch<ServersResult>("/api/tailscale"),
      safeFetch<AnalyticsResult>(analyticsUrl),
      safeFetch<ChecklistResult>("/api/checklists"),
      safeFetch<LiveLogResult>("/api/livelog"),
      safeFetch<OuraResult>(ouraUrl),
    ]);
    setClaude(c as UsageResult);
    setCodex(x as UsageResult);
    setEvents(e as EventsResult);
    setServers(s as ServersResult);
    setAnalytics(a as AnalyticsResult);
    setChecklists(cl as ChecklistResult);
    setLiveLog(ll as LiveLogResult);
    if (ouraRequest === ouraRequestSeq.current) {
      setOura(o as OuraResult);
      setOuraLoading(false);
    }
    setUpdated(Math.floor(Date.now() / 1000));
  }, [analyticsWeekOffset, ouraDayOffset]);

  const changeOuraDayOffset = useCallback((offset: number) => {
    const next = Math.min(0, offset);
    setOuraDayOffset(prev => {
      if (prev === next) return prev;
      setOuraLoading(true);
      return next;
    });
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

      <OuraPanel
        data={oura}
        loading={ouraLoading}
        dayOffset={ouraDayOffset}
        onDayOffsetChange={changeOuraDayOffset}
      />

      <div className="grid grid-2">
        <UsagePanel title="Claude Code" data={claude} />
        <UsagePanel title="Codex" data={codex} />
      </div>

      <ChecklistPanel data={checklists} />

      <LiveLogPanel data={liveLog} />

      <AnalyticsPanel
        data={analytics}
        weekOffset={analyticsWeekOffset}
        onWeekOffsetChange={(offset) => setAnalyticsWeekOffset(Math.min(0, offset))}
      />

      <ServersPanel data={servers} />

      <EventPanels data={events} />
    </main>
  );
}

function UsagePanel({ title, data }: { title: string; data: UsageResult | null }) {
  if (!data) return <Panel title={title}><GaugeSkeleton /></Panel>;
  if (!data.ok) {
    return (
      <Panel title={title}>
        <Unavailable reason={data.error} />
        <FailureLog failures={data.failures} />
      </Panel>
    );
  }
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
          {data.staleReason && (
            <span style={{ display: "block", color: "#7a8595", marginTop: 4 }}>
              Last error: {data.staleReason}
            </span>
          )}
        </p>
      )}
      <div style={{ opacity: isStale ? 0.4 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {data.windows.map(w => (
          <LimitGauge key={w.label} label={w.label} usedPercent={w.usedPercent} resetAt={w.resetAt} windowSecs={w.windowSecs} stale={isStale} />
        ))}
        {data.bankedResets && <BankedResets summary={data.bankedResets} stale={isStale} />}
      </div>
      <FailureLog failures={data.failures} />
    </Panel>
  );
}

function BankedResets({ summary, stale }: { summary: BankedResetSummary; stale: boolean }) {
  const details = summary.resets ?? [];
  const noun = summary.availableCount === 1 ? "reset" : "resets";
  return (
    <div style={{ background: "#0c1015", border: "1px solid #1c222b", borderRadius: 8, padding: "9px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: 13 }}>
        <span style={{ color: "#9aa6b8" }}>Banked resets</span>
        <span>
          <strong style={{ color: summary.availableCount > 0 ? "#7aa2f7" : undefined }}>
            {summary.availableCount}
          </strong>{" "}
          {noun} available
        </span>
      </div>
      {details.map((reset, index) => {
        const remaining = reset.expiresAt == null
          ? null
          : Math.max(0, reset.expiresAt - Math.floor(Date.now() / 1000));
        const expires = remaining == null
          ? "does not expire"
          : remaining === 0
            ? "expired"
            : `expires in ${formatAge(remaining)}`;
        const tooltip = [
          reset.description,
          reset.expiresAt != null ? `Expires ${new Date(reset.expiresAt * 1000).toLocaleString()}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div
            key={`${reset.grantedAt ?? "reset"}-${index}`}
            title={tooltip || undefined}
            style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 11, color: "#7a8595" }}
          >
            <span>{reset.title || `Reset ${index + 1}`}</span>
            <span style={{ whiteSpace: "nowrap" }}>{stale ? "expiration from stale snapshot" : expires}</span>
          </div>
        );
      })}
      {details.length < summary.availableCount && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#7a8595" }}>
          Details unavailable for {summary.availableCount - details.length} {summary.availableCount - details.length === 1 ? "reset" : "resets"}.
        </div>
      )}
    </div>
  );
}

function ServersPanel({ data }: { data: ServersResult | null }) {
  const total = data?.ok ? data.servers.length : 0;
  const up = data?.ok ? data.servers.filter(s => s.online).length : 0;
  const allUp = data?.ok === true && total > 0 && up === total;
  // Collapsed when everything is healthy; auto-expands if a server goes down.
  // A manual click overrides the default until the overall status flips again.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  useEffect(() => { setUserExpanded(null); }, [allUp]);
  const collapsed = userExpanded != null ? !userExpanded : allUp;

  if (!data) {
    return (
      <Panel title="Servers">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </Panel>
    );
  }
  if (!data.ok) {
    return (
      <Panel title="Servers">
        <Unavailable reason={data.error} />
      </Panel>
    );
  }
  return (
    <Panel
      title="Servers"
      collapsed={collapsed}
      onToggle={() => setUserExpanded(collapsed)}
      footer={
        <span
          style={{ color: data.staleReason ? "#f59e0b" : allUp ? "#34d399" : "#ef4444" }}
          title={data.staleReason}
        >
          {up}/{total} online{data.staleReason ? " · stale" : ""}
        </span>
      }
    >
      {data.staleReason && (
        <p style={{ color: "#f59e0b", fontSize: 12, margin: 0 }}>
          Showing the last successful Tailscale status — {data.staleReason}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {data.servers.map(s => <ServerRow key={s.host} server={s} />)}
      </div>
    </Panel>
  );
}

function ServerRow({ server: s }: { server: ServerStatus }) {
  const now = Math.floor(Date.now() / 1000);
  const status = !s.found
    ? "not in tailnet"
    : s.online
    ? "online"
    : s.lastSeen != null
    ? `down · seen ${formatAge(Math.max(0, now - s.lastSeen))} ago`
    : "down";
  const color = s.online ? "#34d399" : s.found ? "#ef4444" : "#7a8595";
  const shortHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(s.host) ? s.host : s.host.split(".")[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0c1015", border: "1px solid #1c222b", borderRadius: 8, minWidth: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: s.online ? "0 0 6px rgba(52, 211, 153, 0.7)" : "none", flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.alias}</div>
        <div style={{ fontSize: 11, color: "#7a8595", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {shortHost !== s.alias && <>{shortHost} · </>}
          <span style={{ color }}>{status}</span>
        </div>
      </div>
    </div>
  );
}

// Collapsed history of recent fetch failures for a usage source. Stays out of
// the way when everything is healthy; expands to timestamped entries.
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
              {formatAge(Math.max(0, now - f.at))} ago{f.count > 1 ? ` ×${f.count}` : ""}
            </span>
            <span style={{ wordBreak: "break-word" }}>{f.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function eventsFooter(total: number): string {
  return total > MAX_EVENT_CARDS ? `${MAX_EVENT_CARDS} of ${total} upcoming` : `${total} upcoming`;
}

function EventPanels({ data }: { data: EventsResult | null }) {
  const [countdownsCollapsed, setCountdownsCollapsed] = useState(false);
  const [anniversariesCollapsed, setAnniversariesCollapsed] = useState(false);
  // Countdowns sort soonest-first; anniversaries sort by upcoming year milestone.
  // Both keep pinned on top. See lib/eventSort.ts for the comparators.
  const countdowns = data?.ok ? data.events.filter(e => !isAnniversaryEvent(e)).sort(byPinnedThenSoonest) : [];
  const anniversaries = data?.ok ? data.events.filter(isAnniversaryEvent).sort(byPinnedThenMilestone) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel
        title="Countdowns"
        collapsed={countdownsCollapsed}
        onToggle={() => setCountdownsCollapsed(!countdownsCollapsed)}
        footer={data?.ok ? eventsFooter(countdowns.length) : undefined}
      >
        <EventsGrid
          events={countdowns}
          loading={!data}
          error={data && !data.ok ? data.error : null}
          emptyText="No upcoming countdowns."
          kind="countdown"
        />
      </Panel>
      <Panel
        title="Anniversaries"
        collapsed={anniversariesCollapsed}
        onToggle={() => setAnniversariesCollapsed(!anniversariesCollapsed)}
        footer={data?.ok ? eventsFooter(anniversaries.length) : undefined}
      >
        <EventsGrid
          events={anniversaries}
          loading={!data}
          error={data && !data.ok ? data.error : null}
          emptyText="No upcoming anniversaries."
          kind="anniversary"
        />
      </Panel>
    </div>
  );
}

function EventsGrid({ events, loading, error, emptyText, kind }: {
  events: EventItem[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  kind: "countdown" | "anniversary";
}) {
  if (loading) return <EventsSkeleton />;
  if (error) return <Unavailable reason={error} />;
  if (events.length === 0) return <p style={{ color: "#7a8595", fontSize: 13, margin: 0 }}>{emptyText}</p>;
  return (
    <div className="grid grid-3">
      {events.slice(0, MAX_EVENT_CARDS).map(e =>
        kind === "anniversary" ? (
          <AnniversaryCard
            key={`${e.title}-${e.start}`}
            title={e.title}
            start={e.start}
            sinceYear={e.sinceYear}
            type={e.anniversaryType ?? (/\bbirthday\b/i.test(e.title) ? "birthday" : "anniversary")}
          />
        ) : (
          <CountdownCard key={`${e.title}-${e.start}`} title={e.title} start={e.start} pinned={e.pinned} />
        )
      )}
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
