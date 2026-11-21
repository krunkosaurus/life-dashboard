import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { parseWorkersConfig } from "../workerConfig";
import { accountMonths, assessWorker, historyStart, monthKeys, networkKey, parseHistory, parsePool, priceDays, summarize } from "../workerEarnings";
import { hostCheckCommand, parseHostChecks } from "../workerChecks";
import type { PoolMonth, WorkerCheckConfig, WorkerCheckResult, WorkerDay, WorkerNetworkRow } from "../workerTypes";

const MAC_ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

describe("worker config", () => {
  const urls = {
    historyUrl: "https://api.example.com/v1/analytics/chart/daily/events/query",
    poolUrl: "https://api.example.com/v1/leaderboard/subscription-workers",
  };
  const nftWorker = {
    id: "gpu-0", label: "GPU box · 0", group: "Image & video", nftTokenId: "123",
    checks: [{ sshHost: "gpubox", container: "comfy-worker-0", label: "Worker container" }],
  };
  const macWorker = {
    id: "mac", label: "Mac", group: "Mac", address: MAC_ADDRESS, network: "relaxed",
    checks: [{ sshHost: "user@mac", process: "Sogni", label: "Sogni app" }],
  };

  it("reads an NFT worker and a wallet worker with their machine checks", () => {
    const config = parseWorkersConfig({ ...urls, workers: [nftWorker, macWorker] });
    expect(config).toEqual({
      ...urls,
      workers: [
        { id: "gpu-0", label: "GPU box · 0", group: "Image & video", account: "GPU box · 0", identity: { nftTokenId: "123" },
          checks: [{ sshHost: "gpubox", container: "comfy-worker-0", label: "Worker container" }] },
        { id: "mac", label: "Mac", group: "Mac", account: "Mac", identity: { address: MAC_ADDRESS, network: "relaxed" },
          checks: [{ sshHost: "user@mac", process: "Sogni", label: "Sogni app" }] },
      ],
    });
  });

  it("is absent when the block or either endpoint is missing", () => {
    expect(parseWorkersConfig(undefined)).toBeNull();
    expect(parseWorkersConfig({ ...urls, historyUrl: "ftp://example.com/x", workers: [nftWorker] })).toBeNull();
    expect(parseWorkersConfig({ historyUrl: urls.historyUrl, workers: [nftWorker] })).toBeNull();
  });

  it("drops a worker whose check could reach the remote shell", () => {
    const config = parseWorkersConfig({ ...urls, workers: [
      { ...nftWorker, id: "inject-container", checks: [{ sshHost: "gpubox", container: "a;reboot", label: "x" }] },
      { ...nftWorker, id: "inject-option", checks: [{ sshHost: "-oProxyCommand=evil", container: "a", label: "x" }] },
      { ...macWorker, id: "inject-process", checks: [{ sshHost: "mac", process: "Sogni$(id)", label: "x" }] },
      nftWorker,
    ] });
    expect(config?.workers.map(worker => worker.id)).toEqual(["gpu-0"]);
  });

  it("drops duplicate ids and workers without exactly one identity", () => {
    const config = parseWorkersConfig({ ...urls, workers: [
      nftWorker,
      { ...macWorker, id: "gpu-0" },
      { ...nftWorker, id: "both", address: MAC_ADDRESS, network: "relaxed" },
      { id: "neither", checks: [] },
      { ...macWorker, id: "bad-address", address: "0x1234" },
      { ...macWorker, id: "bad-network", network: "turbo" },
      { ...nftWorker, id: "bad-token", nftTokenId: "12abc" },
    ] });
    expect(config?.workers.map(worker => worker.id)).toEqual(["gpu-0"]);
  });

  it("fills in labels and allows a worker with no machine checks", () => {
    const config = parseWorkersConfig({ ...urls, workers: [
      { id: "plain", nftTokenId: "3" },
      { id: "unlabelled-check", nftTokenId: "4", checks: [{ sshHost: "box", container: "worker-1" }] },
    ] });
    expect(config?.workers[0]).toEqual({ id: "plain", label: "plain", group: "Workers", account: "plain", identity: { nftTokenId: "3" }, checks: [] });
    expect(config?.workers[1].checks).toEqual([{ sshHost: "box", container: "worker-1", label: "worker-1" }]);
  });

  it("reads the Sogni account a worker earns under, defaulting to its label", () => {
    const config = parseWorkersConfig({ ...urls, workers: [
      { ...nftWorker, account: "studio" },
      { ...macWorker, account: "  " },
    ] });
    expect(config?.workers.map(worker => worker.account)).toEqual(["studio", "Mac"]);
  });
});

describe("worker history", () => {
  // Field order differs from the request order on purpose: values map by name.
  const history = {
    fields: ["connectedSecWorker", "jobCompleteWorker", "jobErrorWorker", "renderEarnSogniWorker", "renderTokenCompleteWorker",
      "renderUSDCompleteWorker", "subscriptionJobSparkWorker", "subscriptionRenderSparkWorker", "workSecWorker"],
    analytics: {
      "1793923200": ["43200", "500", "5", "2500.5", "6000", "30", "5400", "5400", "21600"],
      "1793836800": ["86400", "1000", "10", "5000", "10000", "50", "9000", "9500", "43200"],
      "1793750400": ["0", "0", "0", "0", "0", "0", "0", "0", "0"],
    },
  };

  it("turns the daily counters into hours, jobs and dollars, oldest day first", () => {
    const days = parseHistory(history)!;
    expect(days.map(day => day.date)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(days[1]).toMatchObject({ connectedHours: 24, workingHours: 12, jobsCompleted: 1000, jobsFailed: 10,
      listUsd: 50, sogni: 5000, poolUnits: 9500, poolUsd: null });
    // 1,000 of the day's 10,000 Spark was pay-as-you-go: a tenth of its $50.
    expect(days[1].directUsd).toBeCloseTo(5, 9);
    expect(days[2].directUsd).toBeCloseTo(3, 9);
    expect(days[2].sogni).toBe(2500.5);
  });

  it("reads an idle day as zero dollars", () => {
    expect(parseHistory(history)![0]).toMatchObject({ listUsd: 0, directUsd: 0, poolUnits: 0, connectedHours: 0 });
  });

  it("rejects a payload that is not the requested table instead of reading it as zeros", () => {
    expect(parseHistory({ status: "error" })).toBeNull();
    expect(parseHistory(null)).toBeNull();
    const withoutUsd = { fields: history.fields.filter(name => name !== "renderUSDCompleteWorker"), analytics: history.analytics };
    expect(parseHistory(withoutUsd)).toBeNull();
  });

  it("returns an empty history for a worker with no recorded days", () => {
    expect(parseHistory({ fields: history.fields, analytics: {} })).toEqual([]);
  });

  it("falls back to pool units for the Unlimited share on days before that counter existed", () => {
    // Before 2026-09-30 subscriptionJobSpark was never written: 9,000 of 10,000 Spark earned pool units, so $5 of the $50 was paid in SOGNI.
    const before = { fields: history.fields, analytics: { "1788220800": ["86400", "1000", "10", "5000", "10000", "50", "0", "9000", "43200"] } };
    expect(parseHistory(before)![0].directUsd).toBeCloseTo(5, 9);
    // Relaxed-network work earns two pool units per Spark.
    expect(parseHistory(before, true)![0].directUsd).toBeCloseTo(27.5, 9);
    // A day with no Unlimited work at all stays fully pay-as-you-go.
    const none = { fields: history.fields, analytics: { "1788220800": ["86400", "1000", "10", "5000", "10000", "50", "0", "0", "43200"] } };
    expect(parseHistory(none)![0].directUsd).toBe(50);
  });

  it("asks for history from the first day of the month two months back", () => {
    expect(historyStart(new Date("2026-11-06T14:00:00Z"))).toBe("2026-09-01");
    expect(historyStart(new Date("2027-01-15T00:00:00Z"))).toBe("2026-11-01");
    expect(historyStart(new Date("2027-03-31T23:00:00Z"))).toBe("2027-01-01");
  });

  it("names the three UTC months in view, oldest first", () => {
    expect(monthKeys(new Date("2026-11-06T14:00:00Z"))).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(monthKeys(new Date("2027-01-15T00:00:00Z"))).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("monthly pool", () => {
  const summary = { month: "2026-11", monthStart: "2026-11-01", monthEnd: "2026-12-01", finalized: false,
    usageCoverage: "month_to_date", asOf: "2026-11-07T00:00:00.000Z", workerPoolUsd: 80000, totalRenderSpark: 40_000_000 };
  const rows = [
    { entryType: "nft", nftTokenId: "123", address: "0x2222222222222222222222222222222222222222", value: "250000.00", network: "fast",
      hardwareLabel: "NVIDIA RTX PRO 6000", image: "comfy/1.0.0", lastSeen: "1793956400000", online: true, sharePct: 0.5, estimatedPayoutUsd: 400 },
    { entryType: "address", username: "my-mac-account", address: MAC_ADDRESS, value: "6000.00", network: "relaxed",
      hardwareLabel: "Apple M2 Ultra", lastSeen: "1793974100000", online: false, sharePct: 0.01, estimatedPayoutUsd: 10 },
  ];

  it("prices the month in progress as if the pool accrues evenly by day", () => {
    // 6 of 30 days elapsed: $80,000 x 0.2 over 40M units.
    const pool = parsePool({ summary, rows });
    expect(pool?.month).toMatchObject({ month: "2026-11", workerPoolUsd: 80000, totalUnits: 40_000_000, complete: false, finalized: false });
    expect(pool?.month.usdPerUnit).toBeCloseTo(0.0004, 12);
  });

  it("prices a finished month at the whole pool over all units", () => {
    const pool = parsePool({ summary: { ...summary, month: "2026-10", monthStart: "2026-10-01", monthEnd: "2026-11-01",
      usageCoverage: "full_month", workerPoolUsd: 100000, totalRenderSpark: 200_000_000, finalized: true }, rows: [] });
    expect(pool?.month).toMatchObject({ complete: true, finalized: true });
    expect(pool?.month.usdPerUnit).toBeCloseTo(0.0005, 12);
  });

  it("prices a month with no units yet at zero", () => {
    expect(parsePool({ summary: { ...summary, totalRenderSpark: 0 }, rows: [] })?.month.usdPerUnit).toBe(0);
  });

  it("finds NFT workers by token and wallet workers by address and network, ignoring address case", () => {
    const found = parsePool({ summary, rows })!.rows;
    expect(found.get(networkKey({ nftTokenId: "123" }))).toEqual({ online: true, lastSeen: 1793956400000,
      version: "comfy/1.0.0", hardware: "NVIDIA RTX PRO 6000", sharePct: 0.5 });
    expect(found.get(networkKey({ address: MAC_ADDRESS.toUpperCase().replace("0X", "0x"), network: "relaxed" }))).toEqual({
      online: false, lastSeen: 1793974100000, version: null, hardware: "Apple M2 Ultra", sharePct: 0.01 });
    expect(found.get(networkKey({ address: MAC_ADDRESS, network: "fast" }))).toBeUndefined();
  });

  it("rejects a payload without a pool summary", () => {
    expect(parsePool({ rows })).toBeNull();
    expect(parsePool("nope")).toBeNull();
  });

  it("values each day's pool units at its own month's rate and leaves unknown months unpriced", () => {
    const pools = [{ month: "2026-10", usdPerUnit: 0.0005 }, { month: "2026-11", usdPerUnit: 0.0004 }] as PoolMonth[];
    const priced = priceDays([day("2026-10-31", { poolUnits: 9000, poolUsd: null }), day("2026-11-05", { poolUnits: 9500, poolUsd: null }),
      day("2026-12-01", { poolUnits: 100, poolUsd: null })], pools);
    expect(priced[0].poolUsd).toBeCloseTo(4.5, 9);
    expect(priced[1].poolUsd).toBeCloseTo(3.8, 9);
    expect(priced[2].poolUsd).toBeNull();
  });
});

function day(date: string, overrides: Partial<WorkerDay> = {}): WorkerDay {
  return { date, connectedHours: 24, workingHours: 12, jobsCompleted: 1000, jobsFailed: 0, listUsd: 50, directUsd: 5,
    sogni: 5000, poolUnits: 9000, poolUsd: 4.5, ...overrides };
}

describe("period totals", () => {
  const days = [
    day("2026-10-30", { listUsd: 40, directUsd: 4, poolUsd: 3, sogni: 100, jobsCompleted: 10, jobsFailed: 1, connectedHours: 20, workingHours: 10 }),
    day("2026-10-31", { listUsd: 60, directUsd: 6, poolUsd: 5, sogni: 200, jobsCompleted: 20, jobsFailed: 2, connectedHours: 24, workingHours: 11 }),
    day("2026-11-04", { listUsd: 50, directUsd: 5, poolUsd: 4.5, sogni: 300, jobsCompleted: 30, jobsFailed: 0, connectedHours: 24, workingHours: 12 }),
    day("2026-11-05", { listUsd: 70, directUsd: 7, poolUsd: 6, sogni: 400, jobsCompleted: 40, jobsFailed: 4, connectedHours: 23, workingHours: 13 }),
    day("2026-11-06", { listUsd: 20, directUsd: 2, poolUsd: 1.5, sogni: 500, jobsCompleted: 50, jobsFailed: 5, connectedHours: 14, workingHours: 7 }),
  ];

  it("totals today, yesterday, this month and last month by UTC day", () => {
    const periods = summarize(days, new Date("2026-11-06T14:00:00Z"));
    expect(periods.today).toEqual({ listUsd: 20, directUsd: 2, poolUsd: 1.5, sogni: 500, jobsCompleted: 50, jobsFailed: 5, connectedHours: 14, workingHours: 7 });
    expect(periods.yesterday).toEqual({ listUsd: 70, directUsd: 7, poolUsd: 6, sogni: 400, jobsCompleted: 40, jobsFailed: 4, connectedHours: 23, workingHours: 13 });
    expect(periods.month).toEqual({ listUsd: 140, directUsd: 14, poolUsd: 12, sogni: 1200, jobsCompleted: 120, jobsFailed: 9, connectedHours: 61, workingHours: 32 });
    expect(periods.lastMonth).toEqual({ listUsd: 100, directUsd: 10, poolUsd: 8, sogni: 300, jobsCompleted: 30, jobsFailed: 3, connectedHours: 44, workingHours: 21 });
  });

  it("puts the last day of a month in both yesterday and last month on the 1st", () => {
    // Half an hour into November, only October's days exist.
    const periods = summarize(days.slice(0, 2), new Date("2026-11-01T00:30:00Z"));
    expect(periods.yesterday.listUsd).toBe(60);
    expect(periods.lastMonth.listUsd).toBe(100);
    expect(periods.month.listUsd).toBe(0);
    expect(periods.today.listUsd).toBe(0);
  });

  it("looks back across a year boundary", () => {
    const periods = summarize([day("2026-12-31", { listUsd: 33 }), day("2027-01-01", { listUsd: 11 })], new Date("2027-01-01T01:00:00Z"));
    expect(periods.yesterday.listUsd).toBe(33);
    expect(periods.lastMonth.listUsd).toBe(33);
    expect(periods.month.listUsd).toBe(11);
  });

  it("reports no pool figure for a period containing an unpriced day, keeping its list value", () => {
    const periods = summarize([...days.slice(0, 4), day("2026-11-06", { listUsd: 20, poolUsd: null })], new Date("2026-11-06T14:00:00Z"));
    expect(periods.month.poolUsd).toBeNull();
    expect(periods.month.listUsd).toBe(140);
    expect(periods.yesterday.poolUsd).toBe(6);
  });
});

describe("account totals", () => {
  const months = ["2026-09", "2026-10", "2026-11"];
  const workers = [
    { account: "alpha", days: [day("2026-10-30", { listUsd: 40, directUsd: 4, poolUsd: 3 }), day("2026-11-04", { listUsd: 50, directUsd: 5, poolUsd: 4.5 })] },
    { account: "alpha", days: [day("2026-10-31", { listUsd: 60, directUsd: 6, poolUsd: 5 })] },
    { account: "beta", days: [day("2026-09-15", { listUsd: 10, directUsd: 1, poolUsd: null }), day("2026-10-02", { listUsd: 5, directUsd: 0.5, poolUsd: 0.4 })] },
    { account: "unloaded", days: null },
  ];

  it("adds up each account's workers month by month, largest account first", () => {
    const rows = accountMonths(workers, months);
    expect(rows.map(row => row.account)).toEqual(["alpha", "beta"]);
    expect(rows[0].months.map(total => total.listUsd)).toEqual([0, 100, 50]);
    expect(rows[0].months.map(total => total.poolUsd)).toEqual([0, 8, 4.5]);
    expect(rows[0].months.map(total => total.directUsd)).toEqual([0, 10, 5]);
    expect(rows[1].months.map(total => total.listUsd)).toEqual([10, 5, 0]);
  });

  it("keeps a month unpriced for an account when any of its days is unpriced", () => {
    expect(accountMonths(workers, months)[1].months.map(total => total.poolUsd)).toEqual([null, 0.4, 0]);
  });

  it("leaves out an account whose only worker has no history", () => {
    expect(accountMonths(workers, months).some(row => row.account === "unloaded")).toBe(false);
  });
});

describe("worker issues", () => {
  const NOW = new Date("2026-11-06T14:00:00Z");
  const steadyDays = (overrides: Record<string, Partial<WorkerDay>> = {}): WorkerDay[] => [
    ...["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]
      .map(date => day(date, overrides[date])),
    day("2026-11-06", { connectedHours: 14, workingHours: 7, jobsCompleted: 580, listUsd: 29, directUsd: 2.9, sogni: 2900,
      poolUnits: 5200, poolUsd: 2.6, ...overrides["2026-11-06"] }),
  ];
  const online: WorkerNetworkRow = { online: true, lastSeen: NOW.getTime() - 60_000, version: "comfy/1.0.251", hardware: "NVIDIA GeForce RTX 4090", sharePct: 0.12 };
  const running: WorkerCheckResult = { label: "Worker container", state: "running", detail: "healthy", startedAt: NOW.getTime() - 3 * 86_400_000, restarts: 0 };
  const assess = (input: Partial<Parameters<typeof assessWorker>[0]> = {}) =>
    assessWorker({ days: steadyDays(), network: online, checks: [running], now: NOW, ...input });
  const severities = (result: ReturnType<typeof assessWorker>) => result.issues.map(issue => issue.severity);

  it("finds nothing wrong with a connected, steadily working worker", () => {
    expect(assess()).toEqual({ status: "healthy", issues: [] });
  });

  it.each(["stopped", "missing", "unhealthy"] as const)("treats a %s worker process as critical and names it", state => {
    const result = assess({ checks: [{ ...running, state }] });
    expect(result.status).toBe("critical");
    expect(result.issues[0].title).toContain("Worker container");
  });

  it("treats a machine it could not reach as a warning, not a failure", () => {
    const result = assess({ checks: [{ ...running, state: "unreachable", detail: "SSH could not reach this host." }] });
    expect(result.status).toBe("warning");
    expect(result.issues[0].detail).toContain("SSH could not reach this host.");
  });

  it("flags an automatic restart in the last 24 hours", () => {
    const recent = { ...running, startedAt: NOW.getTime() - 2 * 3_600_000 };
    expect(assess({ checks: [{ ...recent, restarts: 3 }] }).status).toBe("warning");
    expect(assess({ checks: [{ ...recent, restarts: 0 }] }).status).toBe("healthy");
    expect(assess({ checks: [{ ...running, restarts: 3 }] }).status).toBe("healthy");
  });

  it("treats a worker the network reports offline as critical", () => {
    expect(assess({ network: { ...online, online: false } }).status).toBe("critical");
  });

  it("does not fault a worker that has no pool row this month", () => {
    expect(assess({ network: null })).toEqual({ status: "healthy", issues: [] });
  });

  it("flags an hour or more offline yesterday and says how long", () => {
    const result = assess({ days: steadyDays({ "2026-11-05": { connectedHours: 20 } }) });
    expect(severities(result)).toEqual(["warning"]);
    expect(result.issues[0].title).toContain("4.0");
    expect(assess({ days: steadyDays({ "2026-11-05": { connectedHours: 23.5 } }) }).issues).toEqual([]);
  });

  it("flags an hour or more offline so far today, once the day is two hours old", () => {
    const result = assess({ days: steadyDays({ "2026-11-06": { connectedHours: 12 } }) });
    expect(severities(result)).toEqual(["warning"]);
    expect(result.issues[0].title).toContain("2.0");
    expect(assess({ days: steadyDays({ "2026-11-06": { connectedHours: 13.5 } }) }).issues).toEqual([]);
    expect(assess({ days: steadyDays({ "2026-11-06": { connectedHours: 0 } }), now: new Date("2026-11-06T01:00:00Z") }).issues).toEqual([]);
  });

  it("flags a day where at least three jobs and 2% of finished jobs failed", () => {
    expect(assess({ days: steadyDays({ "2026-11-05": { jobsCompleted: 922, jobsFailed: 43 } }) }).status).toBe("warning");
    expect(assess({ days: steadyDays({ "2026-11-05": { jobsCompleted: 1420, jobsFailed: 17 } }) }).issues).toEqual([]);
    expect(assess({ days: steadyDays({ "2026-11-05": { jobsCompleted: 50, jobsFailed: 2 } }) }).issues).toEqual([]);
    expect(assess({ days: steadyDays({ "2026-11-06": { jobsCompleted: 100, jobsFailed: 9 } }) }).status).toBe("warning");
  });

  it("flags a day with under half the work of the week before it", () => {
    expect(assess({ days: steadyDays({ "2026-11-05": { listUsd: 10 } }) }).status).toBe("warning");
    expect(assess({ days: steadyDays({ "2026-11-05": { listUsd: 30 } }) }).issues).toEqual([]);
  });

  it("notes a mostly idle day without calling it a problem", () => {
    const result = assess({ days: steadyDays({ "2026-11-05": { workingHours: 1.8 } }) });
    expect(severities(result)).toEqual(["info"]);
    expect(result.status).toBe("healthy");
  });

  it("warns when the earnings history could not be loaded", () => {
    expect(assess({ days: null }).status).toBe("warning");
  });
});

describe("machine checks", () => {
  const NOW = Date.parse("2026-11-06T14:00:00Z");
  const checks: WorkerCheckConfig[] = [
    { sshHost: "box", container: "worker-0", label: "Worker 0" },
    { sshHost: "box", container: "worker-1", label: "Worker 1" },
    { sshHost: "box", process: "Sogni", label: "Sogni app" },
  ];
  const container = (name: string, status: string, health: string | null, restarts = 0) =>
    JSON.stringify({ container: `/${name}`, status, health, startedAt: "2026-11-06T03:59:07.17211537Z", restarts });

  it("reads running, stopped, unhealthy and absent containers", () => {
    const [first, second] = parseHostChecks(`${container("worker-0", "running", "healthy", 2)}\n${container("worker-1", "exited", null)}\n`, checks, NOW);
    expect(first).toMatchObject({ label: "Worker 0", state: "running", restarts: 2 });
    expect(new Date(first.startedAt!).toISOString()).toBe("2026-11-06T03:59:07.172Z");
    expect(second).toMatchObject({ label: "Worker 1", state: "stopped" });
    expect(parseHostChecks(container("worker-0", "running", "unhealthy"), checks, NOW)[0].state).toBe("unhealthy");
    expect(parseHostChecks("", checks, NOW).map(result => result.state)).toEqual(["missing", "missing", "stopped"]);
  });

  it("ignores a login banner printed around the readings", () => {
    const stdout = `=====\n  SHARED GPU HOST -- lease held\n=====\n${container("worker-0", "running", "healthy")}\n`;
    expect(parseHostChecks(stdout, checks, NOW)[0].state).toBe("running");
  });

  it("dates a running process from its elapsed time", () => {
    const result = parseHostChecks('{"process":"Sogni","etime":"23-10:29:59"}\n', checks, NOW)[2];
    expect(result.state).toBe("running");
    expect(result.startedAt).toBe(NOW - (23 * 86_400 + 10 * 3_600 + 29 * 60 + 59) * 1000);
    expect(parseHostChecks('{"process":"Sogni","etime":"05:07"}\n', checks, NOW)[2].startedAt).toBe(NOW - (5 * 60 + 7) * 1000);
  });

  it("builds one host command whose output it can read back", () => {
    // Stand-ins for the remote tools: docker reports each named container except
    // worker-1, and one matching process has been up 1 day 02:03:04.
    const stubs = [
      "docker() { shift 3; for name in \"$@\"; do [ \"$name\" = worker-1 ] && continue;",
      "printf '{\"container\":\"/%s\",\"status\":\"running\",\"health\":\"healthy\",\"startedAt\":\"2026-11-06T03:59:07Z\",\"restarts\":1}\\n' \"$name\"; done; }",
      "pgrep() { [ \"$2\" = Sogni ] && echo 4242; }",
      "ps() { echo '  1-02:03:04'; }",
    ].join("\n");
    const stdout = execFileSync("sh", ["-c", `${stubs}\n${hostCheckCommand(checks)}`], { encoding: "utf8" });
    const results = parseHostChecks(stdout, checks, NOW);
    expect(results.map(result => result.state)).toEqual(["running", "missing", "running"]);
    expect(results[0].restarts).toBe(1);
    expect(results[2].startedAt).toBe(NOW - (86_400 + 2 * 3_600 + 3 * 60 + 4) * 1000);
  });
});
