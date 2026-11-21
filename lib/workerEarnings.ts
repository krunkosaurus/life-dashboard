import type {
  PoolMonth, WorkerCheckResult, WorkerDay, WorkerIdentity, WorkerIssue, WorkerNetworkRow, WorkerPeriods, WorkerStatus, WorkerTotals,
} from "./workerTypes";

// Daily counters requested for each worker. Spark is the network's job-price unit:
// renderToken* is every completed job in Spark and renderUSD* the same work in dollars;
// subscriptionJobSpark* is the Unlimited-plan part of it, and subscriptionRenderSpark*
// the units that work earns in the monthly pool (double for Relaxed-network jobs).
export const HISTORY_FIELDS = [
  "connectedSecWorker", "workSecWorker", "jobCompleteWorker", "jobErrorWorker", "renderTokenCompleteWorker",
  "renderUSDCompleteWorker", "renderEarnSogniWorker", "subscriptionJobSparkWorker", "subscriptionRenderSparkWorker",
] as const;

const DAY_MS = 86_400_000;

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The three UTC months in view, oldest first. The history endpoint allows 120 days per
// request, which three months fit and four do not.
export function monthKeys(now: Date): string[] {
  return [2, 1, 0].map(back => utcDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).slice(0, 7));
}

export function historyStart(now: Date): string {
  return `${monthKeys(now)[0]}-01`;
}

// Null when the payload is not the daily-counter table that was asked for.
// `relaxed` is the worker's network: Relaxed-network jobs earn two pool units per Spark.
export function parseHistory(data: unknown, relaxed = false): WorkerDay[] | null {
  const body = fields(data);
  const analytics = fields(body?.analytics);
  if (!body || !analytics || !Array.isArray(body.fields)) return null;
  const column = new Map(body.fields.map((name, index) => [name, index]));
  if (!HISTORY_FIELDS.every(name => column.has(name))) return null;
  return Object.entries(analytics).map(([seconds, values]): WorkerDay => {
    const read = (name: typeof HISTORY_FIELDS[number]) => Number((values as unknown[])[column.get(name)!]);
    const spark = read("renderTokenCompleteWorker");
    const listUsd = read("renderUSDCompleteWorker");
    const poolUnits = read("subscriptionRenderSparkWorker");
    // subscriptionJobSpark was first written on 2026-09-30; days before it show the Unlimited
    // share only through their pool units. (Can go once September 2026 leaves the window.)
    const subscriptionSpark = read("subscriptionJobSparkWorker") || poolUnits / (relaxed ? 2 : 1);
    // The two counters are separate running sums, so an all-Unlimited day can differ by float residue.
    const directSpark = Math.max(spark - subscriptionSpark, 0);
    return {
      date: utcDay(Number(seconds) * 1000),
      connectedHours: read("connectedSecWorker") / 3600,
      workingHours: read("workSecWorker") / 3600,
      jobsCompleted: read("jobCompleteWorker"),
      jobsFailed: read("jobErrorWorker"),
      listUsd,
      directUsd: spark > 0 ? listUsd * directSpark / spark : 0,
      sogni: read("renderEarnSogniWorker"),
      poolUnits,
      poolUsd: null,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function networkKey(identity: WorkerIdentity): string {
  return "nftTokenId" in identity ? `nft:${identity.nftTokenId}` : `addr:${identity.address.toLowerCase()}:${identity.network}`;
}

// One month of the public Unlimited-pool board: the pool, and each worker entry's live state.
export function parsePool(data: unknown): { month: PoolMonth; rows: Map<string, WorkerNetworkRow> } | null {
  const body = fields(data);
  const summary = fields(body?.summary);
  if (!body || !summary || typeof summary.month !== "string") return null;
  const workerPoolUsd = Number(summary.workerPoolUsd);
  const totalUnits = Number(summary.totalRenderSpark);
  if (!Number.isFinite(workerPoolUsd) || !Number.isFinite(totalUnits)) return null;
  const complete = summary.usageCoverage === "full_month";
  // The pool figure covers the whole month while units cover only the days so far,
  // so a month in progress is priced on the elapsed share of its pool.
  const start = Date.parse(String(summary.monthStart));
  const elapsed = complete ? 1 : (Date.parse(String(summary.asOf)) - start) / (Date.parse(String(summary.monthEnd)) - start);
  const rows = new Map<string, WorkerNetworkRow>();
  for (const value of Array.isArray(body.rows) ? body.rows : []) {
    const row = fields(value);
    if (!row) continue;
    const key = row.entryType === "nft" ? `nft:${row.nftTokenId}` : `addr:${String(row.address).toLowerCase()}:${row.network}`;
    rows.set(key, {
      online: row.online === true,
      lastSeen: Number(row.lastSeen) || null,
      version: typeof row.image === "string" ? row.image : null,
      hardware: typeof row.hardwareLabel === "string" ? row.hardwareLabel : null,
      sharePct: Number(row.sharePct),
    });
  }
  return {
    month: { month: summary.month, workerPoolUsd, totalUnits, complete, finalized: summary.finalized === true,
      usdPerUnit: totalUnits > 0 ? workerPoolUsd * elapsed / totalUnits : 0 },
    rows,
  };
}

export function priceDays(days: WorkerDay[], pools: PoolMonth[]): WorkerDay[] {
  const rates = new Map(pools.map(pool => [pool.month, pool.usdPerUnit]));
  return days.map(day => {
    const rate = rates.get(day.date.slice(0, 7));
    return { ...day, poolUsd: rate === undefined ? null : day.poolUnits * rate };
  });
}

function total(days: WorkerDay[]): WorkerTotals {
  const sum = (pick: (day: WorkerDay) => number) => days.reduce((n, day) => n + pick(day), 0);
  return {
    listUsd: sum(day => day.listUsd),
    directUsd: sum(day => day.directUsd),
    poolUsd: days.some(day => day.poolUsd === null) ? null : sum(day => day.poolUsd!),
    sogni: sum(day => day.sogni),
    jobsCompleted: sum(day => day.jobsCompleted),
    jobsFailed: sum(day => day.jobsFailed),
    connectedHours: sum(day => day.connectedHours),
    workingHours: sum(day => day.workingHours),
  };
}

export function summarize(days: WorkerDay[], now: Date): WorkerPeriods {
  const today = utcDay(now.getTime());
  const yesterday = utcDay(now.getTime() - DAY_MS);
  const [, lastMonth] = monthKeys(now);
  return {
    today: total(days.filter(day => day.date === today)),
    yesterday: total(days.filter(day => day.date === yesterday)),
    month: total(days.filter(day => day.date.startsWith(today.slice(0, 7)))),
    lastMonth: total(days.filter(day => day.date.startsWith(lastMonth))),
  };
}

// What each Sogni account's workers earned in each month, largest account first.
// Workers whose history did not load are left out, as on the fleet tiles.
export function accountMonths(workers: { account: string; days: WorkerDay[] | null }[], months: string[]): { account: string; months: WorkerTotals[] }[] {
  const byAccount = new Map<string, WorkerDay[]>();
  for (const worker of workers) if (worker.days) byAccount.set(worker.account, [...(byAccount.get(worker.account) ?? []), ...worker.days]);
  return [...byAccount].map(([account, days]) => ({ account, months: months.map(month => total(days.filter(day => day.date.startsWith(month)))) }))
    .sort((a, b) => b.months.reduce((n, t) => n + t.listUsd, 0) - a.months.reduce((n, t) => n + t.listUsd, 0));
}

const hours = (n: number) => `${n.toFixed(1)} ${n.toFixed(1) === "1.0" ? "hour" : "hours"}`;

function ago(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} minutes ago`;
  return minutes < 48 * 60 ? `${(minutes / 60).toFixed(1)} hours ago` : `${(minutes / 1440).toFixed(1)} days ago`;
}

export function assessWorker({ days, network, checks, now }: {
  days: WorkerDay[] | null;
  network: WorkerNetworkRow | null;
  checks: WorkerCheckResult[];
  now: Date;
}): { status: WorkerStatus; issues: WorkerIssue[] } {
  const issues: WorkerIssue[] = [];
  const add = (severity: WorkerIssue["severity"], title: string, detail: string) => issues.push({ severity, title, detail });

  for (const check of checks) {
    if (check.state === "unreachable") add("warning", `Couldn't check ${check.label}`, check.detail);
    else if (check.state === "missing") add("critical", `${check.label} was not found`, "The machine answered, but nothing by that name exists on it. It may have been removed or renamed.");
    else if (check.state === "stopped") add("critical", `${check.label} is not running`, `${check.detail} A stopped worker earns nothing until it is started again.`);
    else if (check.state === "unhealthy") add("critical", `${check.label} is failing its health check`, "Docker reports it running but unhealthy. Check its log before restarting it.");
    else if (check.restarts && check.startedAt !== null && now.getTime() - check.startedAt < DAY_MS) {
      add("warning", `${check.label} restarted in the last 24 hours`, `It last started ${ago(now.getTime() - check.startedAt)}, and Docker has restarted it ${check.restarts} ${check.restarts === 1 ? "time" : "times"} since it was created. Check its log if that was not you.`);
    }
  }

  if (network && !network.online) {
    add("critical", "Offline on the Sogni network", network.lastSeen === null
      ? "The network's worker list shows it disconnected."
      : `The network's worker list shows it disconnected; it was last seen ${ago(now.getTime() - network.lastSeen)}.`);
  }

  if (!days) {
    add("warning", "Earnings history unavailable", "Sogni did not return this worker's daily records, so its earnings and uptime are not shown. Refresh in a minute.");
  } else {
    const todayDate = utcDay(now.getTime());
    const yesterdayDate = utcDay(now.getTime() - DAY_MS);
    const today = days.find(day => day.date === todayDate);
    const yesterday = days.find(day => day.date === yesterdayDate);

    if (yesterday && 24 - yesterday.connectedHours >= 1) {
      add("warning", `Offline ${hours(24 - yesterday.connectedHours)} yesterday`, `Connected for ${hours(yesterday.connectedHours)} of the 24-hour UTC day. Time offline earns nothing.`);
    }
    const elapsedHours = (now.getTime() - Date.parse(todayDate)) / 3_600_000;
    const offlineToday = elapsedHours - (today?.connectedHours ?? 0);
    if (elapsedHours >= 2 && offlineToday >= 1) {
      add("warning", `Offline about ${hours(offlineToday)} so far today`, `Connected for ${hours(today?.connectedHours ?? 0)} of the ${hours(elapsedHours)} since the UTC day began.`);
    }

    for (const [when, day] of [["yesterday", yesterday], ["so far today", today]] as const) {
      if (!day || day.jobsFailed < 3) continue;
      const share = day.jobsFailed / (day.jobsFailed + day.jobsCompleted);
      if (share >= 0.02) add("warning", `${day.jobsFailed} failed jobs ${when}`, `${(share * 100).toFixed(1)}% of the ${day.jobsFailed + day.jobsCompleted} jobs it finished. Failed jobs are unpaid; review the worker log for the cause.`);
    }

    if (yesterday) {
      const week = days.filter(day => day.date < yesterdayDate).slice(-7).map(day => day.listUsd).sort((a, b) => a - b);
      const typical = week[Math.floor(week.length / 2)];
      if (typical > 0 && yesterday.listUsd < typical / 2) {
        add("warning", "Did under half its usual work yesterday", `$${yesterday.listUsd.toFixed(2)} of jobs at list price, against a typical $${typical.toFixed(2)} a day over the week before.`);
      }
      if (yesterday.connectedHours >= 12 && yesterday.workingHours / yesterday.connectedHours < 0.25) {
        add("info", "Idle most of yesterday", `Worked ${hours(yesterday.workingHours)} of ${hours(yesterday.connectedHours)} connected. That reflects demand for the models it serves, not a fault.`);
      }
    }
  }

  const status = issues.some(issue => issue.severity === "critical") ? "critical"
    : issues.some(issue => issue.severity === "warning") ? "warning" : "healthy";
  return { status, issues };
}
