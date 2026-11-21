"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { niceScale } from "@/lib/chart";
import { accountMonths, monthKeys } from "@/lib/workerEarnings";
import type { PoolMonth, WorkerReport, WorkersResult, WorkerTotals } from "@/lib/workerTypes";
import "./gpu-dashboard.css";
import "./workers-dashboard.css";

type Measure = "payout" | "list";
type ChartDay = WorkerTotals & { date: string };

const DAY_MS = 86_400_000;
const PERIODS = [["today", "Today so far"], ["yesterday", "Yesterday"], ["month", "This month"], ["lastMonth", "Last month"]] as const;
const statusLabels: Record<WorkerReport["status"], string> = { healthy: "No issues detected", warning: "Needs attention", critical: "Critical" };

const usd = (n: number | null) => n === null ? "—" : n.toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: n >= 100 ? 0 : 2, maximumFractionDigits: n >= 100 ? 0 : 2,
});
const count = (n: number) => Math.round(n).toLocaleString("en-US");
const payout = (t: Pick<WorkerTotals, "directUsd" | "poolUsd">) => t.poolUsd === null ? null : t.directUsd + t.poolUsd;
// Times use the viewer's own zone; Sogni's days are UTC and are labelled as such.
const localTime = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const utcDayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function sumTotals(list: WorkerTotals[]): WorkerTotals {
  return list.reduce<WorkerTotals>((sum, t) => ({
    listUsd: sum.listUsd + t.listUsd,
    directUsd: sum.directUsd + t.directUsd,
    poolUsd: sum.poolUsd === null || t.poolUsd === null ? null : sum.poolUsd + t.poolUsd,
    sogni: sum.sogni + t.sogni,
    jobsCompleted: sum.jobsCompleted + t.jobsCompleted,
    jobsFailed: sum.jobsFailed + t.jobsFailed,
    connectedHours: sum.connectedHours + t.connectedHours,
    workingHours: sum.workingHours + t.workingHours,
  }), { listUsd: 0, directUsd: 0, poolUsd: 0, sogni: 0, jobsCompleted: 0, jobsFailed: 0, connectedHours: 0, workingHours: 0 });
}

function fleetDays(workers: WorkerReport[]): ChartDay[] {
  const byDate = new Map<string, WorkerTotals[]>();
  for (const worker of workers) for (const day of worker.days ?? []) byDate.set(day.date, [...(byDate.get(day.date) ?? []), day]);
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, days]) => ({ date, ...sumTotals(days) }));
}

function CoinsIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M15 11.2c3.4.1 6 1.4 6 3v3c0 1.7-2.7 3-6 3s-6-1.3-6-3v-2" /></svg>;
}

export function WorkersDashboard() {
  const [data, setData] = useState<WorkersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  // Set after mount: the server renders this page in its own time zone, not the viewer’s.
  const [utcMidnight, setUtcMidnight] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workers", { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The worker snapshot failed.");
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // One request on entry. No interval, focus refresh, or visibility polling.
    void refresh();
    setUtcMidnight(new Date(new Date().setUTCHours(0, 0, 0, 0)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    return () => request.current?.abort();
  }, [refresh]);

  return (
    <main className="gpu-page workers-page">
      <header className="gpu-header">
        <div>
          <div className="gpu-eyebrow"><CoinsIcon /> WHAT YOUR MACHINES EARN</div>
          <h1>Workers</h1>
          <p>Earnings by day and month, and anything that needs a closer look.</p>
        </div>
        <div className="gpu-refresh-area">
          <span className="gpu-mode"><i /> On-demand checks</span>
          <button className="gpu-button" onClick={() => void refresh()} disabled={loading}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .4 5M16 3v4h-4" /></svg>
            {loading ? "Checking workers…" : "Refresh snapshot"}
          </button>
        </div>
      </header>

      <div className="gpu-snapshot-note" role="status">
        <span>{loading ? "Taking a fresh snapshot. Slow or unreachable machines may take longer." : data ? `Snapshot · ${localTime(data.checkedAt)} · ${(data.durationMs / 1000).toFixed(1)}s to check` : "No snapshot available"}</span>
        <span>Checks run when you open this tab or press refresh.</span>
      </div>
      {error && <div className="gpu-error" role="alert">{error} {data && "Showing the previous snapshot; its timestamp is unchanged."}</div>}
      {data?.errors.map(message => <div className="gpu-error" role="alert" key={message}>{message}</div>)}

      {loading && !data ? <div className="gpu-loading" aria-label="Loading workers"><div className="gpu-summary">{[0, 1, 2, 3].map(n => <div className="gpu-stat" key={n}><div className="skel-line" /><div className="skel-line" /></div>)}</div><div className="gpu-machine-grid">{[0, 1, 2, 3].map(n => <div className="gpu-card gpu-card-skeleton" key={n}><div className="skel-line" /><div className="skel-line" /><div className="skel-line" /></div>)}</div></div>
        : data && data.workers.length === 0 ? <div className="gpu-empty"><CoinsIcon /><h2>Your workers belong here</h2><p>Add a <code>workers</code> block to <code>config.local.json</code>: the two public data endpoints, then each worker with its NFT number or wallet and the machine checks to run.</p><p>Machine checks use the dashboard machine’s existing SSH access and only read state.</p></div>
        : data && <Fleet data={data} />}

      <section className="gpu-guide">
        <div className="gpu-section-heading"><h2>Make sense of the numbers</h2><span>A quick field guide</span></div>
        <div className="gpu-guide-grid">
          <div><span className="gpu-guide-number">01</span><h3>Two dollar figures</h3><p>Estimated payout is what the work actually pays: SOGNI credited for pay-as-you-go jobs, valued when it was earned, plus a share of the month’s Unlimited pool. List value prices the same jobs at the public job price. Unlimited-plan jobs are not paid at that price, which is why list value runs far higher.</p></div>
          <div><span className="gpu-guide-number">02</span><h3>The pool is an estimate until the month closes</h3><p>Unlimited-plan work is paid from a fixed share of that month’s net subscription revenue, split by each worker’s share of the work. The pool figure already covers the whole month while the work only covers the days so far, so the month in progress is priced on the elapsed share of its pool and daily figures move as subscriptions and network-wide work change. A month firms up when Sogni finalizes its pool; until then it is marked “pool estimate”.</p></div>
          <div><span className="gpu-guide-number">03</span><h3>Days are UTC days</h3><p>Each day is totalled from midnight UTC{utcMidnight && `, which is ${utcMidnight} in your time zone`}, so “today” and “yesterday” here can differ from your calendar. Clock times on this page are in your time zone.</p></div>
        </div>
        <div className="gpu-guide-footer">Idle time is normal: a connected worker only earns while jobs for its models arrive · Failed jobs are unpaid · SOGNI is valued at the price when each job was paid, not today’s price</div>
      </section>
      <footer className="gpu-footer">Read-only. Earnings come from the network’s public worker records, read at most once a minute. Machine checks only read container and process state over SSH; nothing on a worker is changed.</footer>
    </main>
  );
}

function Fleet({ data }: { data: WorkersResult }) {
  const [group, setGroup] = useState("All workers");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [measure, setMeasure] = useState<Measure>("payout");

  const workers = data.workers;
  const reporting = workers.filter(worker => worker.periods);
  const fleet = Object.fromEntries(PERIODS.map(([key]) => [key, sumTotals(reporting.map(worker => worker.periods![key]))])) as Record<typeof PERIODS[number][0], WorkerTotals>;
  const now = new Date(data.checkedAt);
  const today = now.toISOString().slice(0, 10);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const monthPayout = payout(fleet.month);
  // A pace needs at least one full day behind it.
  const elapsed = data.checkedAt - monthStart >= DAY_MS ? (data.checkedAt - monthStart) / (monthEnd - monthStart) : null;
  const pace = monthPayout !== null && elapsed !== null ? monthPayout / elapsed : null;
  const lastPool = data.pools.find(pool => pool.month !== today.slice(0, 7));
  // Without this month’s pool board there is no live network state to report.
  const networkKnown = data.pools.some(pool => pool.month === today.slice(0, 7));
  const chartDays = fleetDays(reporting).slice(-30);
  const online = workers.filter(worker => worker.network?.online).length;
  const attention = workers.filter(worker => worker.status !== "healthy");
  const groups = ["All workers", ...new Set(workers.map(worker => worker.group))];
  const visible = workers.filter(worker => (group === "All workers" || worker.group === group) && (!attentionOnly || worker.status !== "healthy"));
  const issues = workers.flatMap(worker => worker.issues.filter(issue => issue.severity !== "info").map(issue => ({ ...issue, worker })))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
  const showAll = () => { setGroup("All workers"); setAttentionOnly(false); };
  const issueLink = (issue: typeof issues[number], index: number) => <a key={`${issue.worker.id}-${index}`} className={`gpu-issue gpu-issue-${issue.severity}`} href={`#worker-${issue.worker.id}`} onClick={showAll}><span className="gpu-issue-marker" /><strong>{issue.worker.label}</strong><span>{issue.title}</span><span aria-hidden="true">↗</span></a>;

  return <>
    {reporting.length < workers.length && <div className="gpu-error" role="alert">Earnings loaded for {reporting.length} of {workers.length} workers; the totals below cover only those.</div>}
    <section className="gpu-summary" aria-label="Fleet earnings, estimated payout">
      <Summary label="EST. PAYOUT · TODAY SO FAR" value={usd(payout(fleet.today))} note={`${usd(fleet.today.listUsd)} at list price · ${((data.checkedAt - Date.parse(today)) / 3_600_000).toFixed(0)} h into the UTC day`} tone="mint" />
      <Summary label="EST. PAYOUT · YESTERDAY" value={usd(payout(fleet.yesterday))} note={`${usd(fleet.yesterday.listUsd)} at list price · ${utcDayLabel(new Date(data.checkedAt - DAY_MS).toISOString().slice(0, 10))} UTC`} tone="blue" />
      <Summary label="EST. PAYOUT · THIS MONTH" value={usd(monthPayout)} note={`${usd(fleet.month.listUsd)} at list price${pace === null ? "" : ` · on pace for ${usd(pace)}`}`} tone="purple" />
      <Summary label="EST. PAYOUT · LAST MONTH" value={usd(payout(fleet.lastMonth))} note={`${usd(fleet.lastMonth.listUsd)} at list price${lastPool ? lastPool.finalized ? " · pool final" : " · pool not final yet" : ""}`} tone="blue" />
    </section>

    {issues.length > 0 && <section className="gpu-attention" aria-label="Issues to review">
      <div className="gpu-section-heading"><h2><span className="gpu-alert-symbol">!</span> Worth your attention</h2><span>{issues.length} {issues.length === 1 ? "finding" : "findings"}</span></div>
      <div className="gpu-issues-list">{issues.slice(0, 4).map(issueLink)}</div>
      {issues.length > 4 && <details className="gpu-more-issues"><summary>Show {issues.length - 4} more</summary>{issues.slice(4).map(issueLink)}</details>}
    </section>}

    <div className="workers-measure">
      <span>Charts show</span>
      <div className="gpu-filters" aria-label="Chart measure">
        <button onClick={() => setMeasure("payout")} aria-pressed={measure === "payout"}>Estimated payout</button>
        <button onClick={() => setMeasure("list")} aria-pressed={measure === "list"}>List value</button>
      </div>
    </div>

    <section className="workers-panel" aria-label="Fleet earnings per day">
      <div className="gpu-section-heading"><h2>{measure === "list" ? "List value" : "Estimated payout"} per day</h2><span>All workers · last {chartDays.length} UTC days</span></div>
      {measure === "payout" && <div className="workers-legend"><span><i className="workers-seg-pool" />Unlimited pool (estimate)</span><span><i className="workers-seg-direct" />Paid in SOGNI</span></div>}
      <DailyChart days={chartDays} measure={measure} today={today} label="All workers" />
      <details><summary>Daily figures as a table</summary><DayTable days={chartDays} today={today} /></details>
    </section>

    <AccountTable workers={reporting} pools={data.pools} measure={measure} now={now} elapsed={elapsed} />

    <section aria-label="Workers">
      <div className="gpu-fleet-toolbar">
        <div className="gpu-filters" aria-label="Filter workers">{groups.map(label => <button key={label} onClick={() => setGroup(label)} aria-pressed={group === label}>{label}</button>)}</div>
        <div className="workers-fleet-status"><span>{online} of {workers.length} online · {attention.length} need a look</span><label className="gpu-attention-toggle"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} /> Needs attention only</label></div>
      </div>
      <div className="gpu-machine-grid">{visible.map(worker => <WorkerCard key={worker.id} worker={worker} measure={measure} today={today} networkKnown={networkKnown} />)}</div>
      {visible.length === 0 && <p className="gpu-empty-filter">No workers match this filter.</p>}
    </section>
  </>;
}

// What lands in each Sogni account, month by month. `elapsed` is the share of the current
// month gone by, or null while the month is too young to project.
function AccountTable({ workers, pools, measure, now, elapsed }: { workers: WorkerReport[]; pools: PoolMonth[]; measure: Measure; now: Date; elapsed: number | null }) {
  const months = monthKeys(now);
  const thisMonth = months[months.length - 1];
  const rows = accountMonths(workers, months);
  if (rows.length === 0) return null;
  const totals = months.map((_, index) => sumTotals(rows.map(row => row.months[index])));
  const labels = new Map<string, string[]>();
  for (const worker of workers) labels.set(worker.account, [...(labels.get(worker.account) ?? []), worker.label]);
  const standing = (month: string) => {
    if (month === thisMonth) return "so far";
    const pool = pools.find(pool => pool.month === month);
    return pool ? pool.finalized ? "pool final" : "pool estimate" : "pool not loaded";
  };
  const cell = (t: WorkerTotals, month: string) => {
    if (measure === "list") return <td><strong>{usd(t.listUsd)}</strong><small>{count(t.jobsCompleted)} jobs</small></td>;
    const total = payout(t);
    const pace = month === thisMonth && total !== null && elapsed !== null ? ` · on pace ${usd(total / elapsed)}` : "";
    return <td><strong>{usd(total)}</strong><small>{usd(t.poolUsd)} pool · {usd(t.directUsd)} SOGNI{pace}</small></td>;
  };
  return <section className="workers-panel" aria-label="Earnings by account">
    <div className="gpu-section-heading"><h2>{measure === "list" ? "List value" : "Estimated payout"} by account</h2><span>Per UTC month</span></div>
    <div className="workers-table-wrap">
      <table className="workers-table workers-accounts">
        <thead><tr><th>Account</th>{months.map(month => <th key={month}>{monthLabel(month)}<small>{standing(month)}</small></th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.account}>
          <th><strong>{row.account}</strong><small>{labels.get(row.account)?.join(", ")}</small></th>
          {row.months.map((t, index) => <Fragment key={months[index]}>{cell(t, months[index])}</Fragment>)}
        </tr>)}</tbody>
        <tfoot><tr><th>All accounts</th>{totals.map((t, index) => <Fragment key={months[index]}>{cell(t, months[index])}</Fragment>)}</tr></tfoot>
      </table>
    </div>
    {measure === "payout" && <p className="workers-note">Pool money is paid in USDC once Sogni finalizes the month; SOGNI is paid per job at the time and valued here at what the job was worth then.</p>}
  </section>;
}

function Summary({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <div className={`gpu-stat gpu-stat-${tone}`}><span className="gpu-stat-label">{label}</span><div className="gpu-stat-value">{value}</div><p>{note}</p></div>;
}

function Meter({ label, value, note, tone = "blue" }: { label: string; value: number | null; note: string; tone?: string }) {
  const text = value === null ? "—" : `${Math.round(value)}%`;
  return <div className={`gpu-meter gpu-meter-${tone}`}><div><span>{label}</span><strong>{text}</strong></div><div className="gpu-meter-track" role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-valuetext={value === null ? "Not reported" : text}><span style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></div><small>{note}</small></div>;
}

// Stacked columns, one per UTC day. Hover a column, or focus the chart and use the arrow keys.
function DailyChart({ days, measure, today, label, compact = false }: { days: ChartDay[]; measure: Measure; today: string; label: string; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const value = (day: ChartDay) => measure === "list" ? day.listUsd : day.directUsd + (day.poolUsd ?? 0);
  const peak = Math.max(0, ...days.map(value));
  const scale: { max: number; ticks: number[] } = compact ? { max: peak || 1, ticks: [] } : niceScale(peak);
  const shown = active === null ? undefined : days[active];
  const move = (event: KeyboardEvent) => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    setActive(index => Math.min(days.length - 1, Math.max(0, (index ?? days.length - 1) + step)));
  };
  return (
    <div className={`workers-chart${compact ? " workers-chart-compact" : ""}`}>
      <div className="workers-chart-plot" tabIndex={0} role="group" aria-label={`${label}: ${measure === "list" ? "list value" : "estimated payout"} per day. Use the left and right arrow keys to read each day.`}
        onKeyDown={move} onFocus={() => setActive(index => index ?? days.length - 1)} onBlur={() => setActive(null)} onMouseLeave={() => setActive(null)}>
        {scale.ticks.map(tick => <div key={tick} className="workers-chart-grid" style={{ bottom: `${tick / scale.max * 100}%` }}><span>${tick.toLocaleString("en-US")}</span></div>)}
        <div className="workers-chart-columns">
          {days.map((day, index) => (
            <div key={day.date} className="workers-chart-slot" data-active={index === active} data-partial={day.date === today} onMouseEnter={() => setActive(index)}>
              <div className="workers-chart-bar" style={{ height: `${value(day) / scale.max * 100}%` }}>
                {measure === "list" ? <span className="workers-seg-list" /> : <>
                  {day.directUsd > 0 && <span className="workers-seg-direct" style={{ flexGrow: day.directUsd }} />}
                  {day.poolUsd !== null && day.poolUsd > 0 && <span className="workers-seg-pool" style={{ flexGrow: day.poolUsd }} />}
                </>}
              </div>
            </div>
          ))}
        </div>
        {shown && <div className="workers-chart-tip" role="status" style={{ left: `clamp(88px, ${(active! + 0.5) / days.length * 100}%, calc(100% - 88px))` }}>
          <span>{utcDayLabel(shown.date)} UTC{shown.date === today ? " · so far" : ""}</span>
          <span><strong>{usd(measure === "list" ? shown.listUsd : payout(shown))}</strong>{measure === "list" ? "list value" : "estimated payout"}</span>
          {measure === "payout" && <>
            <span><i className="workers-key workers-seg-pool" /><b>{usd(shown.poolUsd)}</b>Unlimited pool</span>
            <span><i className="workers-key workers-seg-direct" /><b>{usd(shown.directUsd)}</b>Paid in SOGNI</span>
          </>}
          <span><b>{usd(measure === "list" ? payout(shown) : shown.listUsd)}</b>{measure === "list" ? "estimated payout" : "at list price"}</span>
        </div>}
      </div>
      {!compact && <div className="workers-chart-axis" aria-hidden="true">{days.map((day, index) => (days.length - 1 - index) % 7 === 0 && <span key={day.date} style={{ left: `${(index + 0.5) / days.length * 100}%` }}>{utcDayLabel(day.date)}</span>)}</div>}
    </div>
  );
}

function DayTable({ days, today, connected = false }: { days: ChartDay[]; today: string; connected?: boolean }) {
  return <div className="workers-table-wrap"><table className="workers-table">
    <thead><tr><th scope="col">UTC day</th><th scope="col">Est. payout</th><th scope="col">Unlimited pool</th><th scope="col">Paid in SOGNI</th><th scope="col">List value</th><th scope="col">Jobs</th><th scope="col">Failed</th>{connected && <th scope="col">Connected</th>}</tr></thead>
    <tbody>{[...days].reverse().map(day => <tr key={day.date}>
      <td>{utcDayLabel(day.date)}{day.date === today && " · so far"}</td><td>{usd(payout(day))}</td><td>{usd(day.poolUsd)}</td><td>{usd(day.directUsd)}</td><td>{usd(day.listUsd)}</td><td>{count(day.jobsCompleted)}</td><td>{count(day.jobsFailed)}</td>{connected && <td>{day.connectedHours.toFixed(1)} h</td>}
    </tr>)}</tbody>
  </table></div>;
}

function WorkerCard({ worker, measure, today, networkKnown }: { worker: WorkerReport; measure: Measure; today: string; networkKnown: boolean }) {
  const { periods, days, network } = worker;
  const meta = [network?.hardware, network?.version, worker.identity, network ? network.online ? "Online on the network" : "Offline on the network" : networkKnown && "No Unlimited work recorded this month"].filter(Boolean);
  return <article id={`worker-${worker.id}`} className={`gpu-card gpu-card-${worker.status}`}>
    <div className="gpu-card-heading"><div><span className="gpu-machine-group">{worker.group}</span><h3>{worker.label}</h3></div><span className={`gpu-status gpu-status-${worker.status}`}><i />{statusLabels[worker.status]}</span></div>
    <p className="gpu-host-meta">{meta.map((part, index) => <Fragment key={index}>{index > 0 && <span>·</span>}{part}</Fragment>)}</p>
    {periods && days ? <>
      <table className="workers-earnings">
        <thead><tr><td /><th scope="col">Est. payout</th><th scope="col">List value</th></tr></thead>
        <tbody>{PERIODS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{usd(payout(periods[key]))}</td><td>{usd(periods[key].listUsd)}</td></tr>)}</tbody>
      </table>
      <div className="workers-mini"><span>{measure === "list" ? "List value" : "Estimated payout"} per day · last 30 UTC days</span><DailyChart days={days.slice(-30)} measure={measure} today={today} label={worker.label} compact /></div>
      <div className="gpu-host-meters">
        <Meter label="Connected yesterday" value={periods.yesterday.connectedHours / 24 * 100} note={`${periods.yesterday.connectedHours.toFixed(1)} of 24 hours`} tone="mint" />
        <Meter label="Working while connected" value={periods.yesterday.connectedHours > 0 ? periods.yesterday.workingHours / periods.yesterday.connectedHours * 100 : null} note={`${periods.yesterday.workingHours.toFixed(1)} of ${periods.yesterday.connectedHours.toFixed(1)} hours yesterday`} />
      </div>
      <div className="gpu-card-strip"><span>Jobs yesterday <strong>{count(periods.yesterday.jobsCompleted)}</strong></span><span className={periods.yesterday.jobsFailed > 0 ? "gpu-thermal-warning" : ""}>{count(periods.yesterday.jobsFailed)} failed</span></div>
    </> : <div className="gpu-unreachable"><span aria-hidden="true">⌁</span><p>Couldn’t read this worker’s earnings.</p><small>Machine checks below still ran.</small></div>}
    {worker.issues.length > 0 && <div className="gpu-card-findings">{worker.issues.slice(0, 2).map((issue, index) => <p key={index} className={`gpu-finding-${issue.severity}`}><span aria-hidden="true">{issue.severity === "info" ? "i" : "!"}</span>{issue.title}</p>)}{worker.issues.length > 2 && <small>+{worker.issues.length - 2} more in details</small>}</div>}
    <details className="gpu-details"><summary>Worker details <span>Checks, monthly figures & daily history</span></summary>
      <div className="gpu-details-body">
        {worker.issues.map((issue, index) => <div className={`gpu-detail-issue gpu-detail-${issue.severity}`} key={index}><strong>{issue.title}</strong><p>{issue.detail}</p></div>)}
        {worker.checks.length > 0 && <><h4>On the machine</h4><dl className="gpu-detail-values">{worker.checks.map((check, index) => <div key={index}><dt>{check.label}</dt><dd>{check.detail}{check.startedAt !== null && ` Started ${localTime(check.startedAt)}.`}{check.restarts ? ` Auto-restarted ${check.restarts}×.` : ""}</dd></div>)}</dl></>}
        {network && <><h4>On the network</h4><dl className="gpu-detail-values">
          <div><dt>Last seen</dt><dd>{network.lastSeen === null ? "Not reported" : localTime(network.lastSeen)}</dd></div>
          <div><dt>Share of this month’s Unlimited pool</dt><dd>{network.sharePct.toFixed(3)}%</dd></div>
        </dl></>}
        {periods && days && <>
          <h4>This month and last</h4>
          <div className="workers-table-wrap"><table className="workers-table">
            <thead><tr><td /><th scope="col">This month</th><th scope="col">Last month</th></tr></thead>
            <tbody>
              <tr><td>Unlimited pool (estimate)</td><td>{usd(periods.month.poolUsd)}</td><td>{usd(periods.lastMonth.poolUsd)}</td></tr>
              <tr><td>Paid in SOGNI, value when earned</td><td>{usd(periods.month.directUsd)}</td><td>{usd(periods.lastMonth.directUsd)}</td></tr>
              <tr><td>SOGNI credited</td><td>{count(periods.month.sogni)}</td><td>{count(periods.lastMonth.sogni)}</td></tr>
              <tr><td>Jobs finished / failed</td><td>{count(periods.month.jobsCompleted)} / {count(periods.month.jobsFailed)}</td><td>{count(periods.lastMonth.jobsCompleted)} / {count(periods.lastMonth.jobsFailed)}</td></tr>
              <tr><td>Hours connected / working</td><td>{count(periods.month.connectedHours)} / {count(periods.month.workingHours)}</td><td>{count(periods.lastMonth.connectedHours)} / {count(periods.lastMonth.workingHours)}</td></tr>
            </tbody>
          </table></div>
          <h4>Last 14 days</h4>
          <DayTable days={days.slice(-14)} today={today} connected />
        </>}
      </div>
    </details>
  </article>;
}
