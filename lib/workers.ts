import { execFile } from "node:child_process";
import { loadConfig } from "./config";
import { hostCheckCommand, parseHostChecks } from "./workerChecks";
import { assessWorker, HISTORY_FIELDS, historyStart, monthKeys, networkKey, parseHistory, parsePool, priceDays, summarize } from "./workerEarnings";
import type { PoolMonth, WorkerCheckConfig, WorkerCheckResult, WorkerConfig, WorkerDay, WorkerNetworkRow, WorkerReport, WorkersConfig, WorkersResult } from "./workerTypes";

// The API is rate-limited per IP, so a burst of refreshes reuses one read per URL for a minute.
const API_TTL_MS = 60_000;
const apiCache = new Map<string, { at: number; data: unknown }>();

async function getJson(url: string): Promise<unknown> {
  const now = Date.now();
  for (const [key, entry] of apiCache) if (now - entry.at >= API_TTL_MS) apiCache.delete(key);
  const cached = apiCache.get(url);
  if (cached) return cached.data;
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  const data = (await response.json() as { data?: unknown }).data;
  apiCache.set(url, { at: now, data });
  return data;
}

async function eachLimited<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

function describeSshError(error: unknown): string {
  const e = error as { message?: string; stderr?: string; killed?: boolean };
  const detail = `${e.stderr ?? ""} ${e.message ?? ""}`;
  if (/Permission denied|authentication failed/i.test(detail)) return "SSH sign-in was refused. Check the dashboard user's key on that machine.";
  if (e.killed || /timed out|ETIMEDOUT/i.test(detail)) return "The check timed out. The machine may be busy, asleep, or on a slow network; this does not prove the worker is down.";
  return "SSH could not reach this machine. Check its power, network, and SSH service.";
}

function runOnHost(sshHost: string, command: string): Promise<string> {
  const args = ["-n", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "-o", "StrictHostKeyChecking=yes",
    "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none", sshHost, command];
  return new Promise((resolve, reject) => {
    execFile("ssh", args, { timeout: 25_000, maxBuffer: 256 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }));
      else resolve(stdout);
    });
  });
}

// One SSH session per machine covers every check on it, four machines at a time.
async function checkMachines(workers: WorkerConfig[]): Promise<Map<WorkerCheckConfig, WorkerCheckResult>> {
  const byHost = new Map<string, WorkerCheckConfig[]>();
  for (const check of workers.flatMap(worker => worker.checks)) byHost.set(check.sshHost, [...(byHost.get(check.sshHost) ?? []), check]);
  const results = new Map<WorkerCheckConfig, WorkerCheckResult>();
  await eachLimited([...byHost], 4, async ([sshHost, checks]) => {
    try {
      const readings = parseHostChecks(await runOnHost(sshHost, hostCheckCommand(checks)), checks, Date.now());
      checks.forEach((check, index) => results.set(check, readings[index]));
    } catch (error) {
      const detail = describeSshError(error);
      for (const check of checks) results.set(check, { label: check.label, state: "unreachable", detail, startedAt: null, restarts: null });
    }
  });
  return results;
}

function describeIdentity(worker: WorkerConfig): string {
  return "nftTokenId" in worker.identity
    ? `NFT ${worker.identity.nftTokenId}`
    : `Wallet ${worker.identity.address.slice(0, 6)}…${worker.identity.address.slice(-4)} · ${worker.identity.network}`;
}

async function collect(config: WorkersConfig): Promise<WorkersResult> {
  const start = Date.now();
  const now = new Date(start);
  const from = historyStart(now);
  const errors: string[] = [];
  // A rate-limit answer stops further requests in this snapshot instead of pressing on.
  let rateLimited = false;
  const read = async (url: string): Promise<unknown> => {
    if (rateLimited) throw new Error("rate limited");
    try {
      return await getJson(url);
    } catch (error) {
      if ((error as { status?: number }).status === 429) rateLimited = true;
      throw error;
    }
  };

  const loadPool = async (month: string, limit: number) => {
    try {
      return parsePool(await read(`${config.poolUrl}?month=${month}&limit=${limit}`));
    } catch {
      return null;
    }
  };
  const loadHistory = async (worker: WorkerConfig): Promise<WorkerDay[] | null> => {
    const who = "nftTokenId" in worker.identity
      ? `nftTokenId=${worker.identity.nftTokenId}`
      : `address=${worker.identity.address}&network=${worker.identity.network}`;
    const relaxed = "network" in worker.identity && worker.identity.network === "relaxed";
    try {
      return parseHistory(await read(`${config.historyUrl}?${who}&startDate=${from}&query=${HISTORY_FIELDS.join(",")}`), relaxed);
    } catch {
      return null;
    }
  };

  const months = monthKeys(now);
  const thisMonth = months[months.length - 1];
  // Only the current month's rows are needed (live state); earlier months need just their pool summary.
  const [boards, histories, checks] = await Promise.all([
    Promise.all(months.map(month => loadPool(month, month === thisMonth ? 1000 : 1))),
    eachLimited(config.workers, 3, loadHistory),
    checkMachines(config.workers),
  ]);
  const current = boards[boards.length - 1];

  if (rateLimited) errors.push("Sogni's API asked this dashboard to slow down, so some figures are missing. Wait a minute before refreshing.");
  if (!current) errors.push(`This month's Unlimited pool could not be read, so pool earnings for ${thisMonth} and live network status are not shown.`);
  for (const [index, month] of months.slice(0, -1).entries()) {
    if (!boards[index]) errors.push(`The Unlimited pool for ${month} could not be read, so pool earnings for that month are not shown.`);
  }

  const pools = boards.map(board => board?.month).filter((pool): pool is PoolMonth => pool != null);

  const workers = config.workers.map((worker, index): WorkerReport => {
    const days = histories[index] && priceDays(histories[index], pools);
    const network: WorkerNetworkRow | null = current?.rows.get(networkKey(worker.identity)) ?? null;
    const results = worker.checks.map(check => checks.get(check)!);
    return {
      id: worker.id, label: worker.label, group: worker.group, account: worker.account, identity: describeIdentity(worker),
      ...assessWorker({ days, network, checks: results, now }),
      network, checks: results, days, periods: days && summarize(days, now),
    };
  });
  // Stamped with the clock the day boundaries above were computed from.
  return { checkedAt: start, durationMs: Date.now() - start, pools, errors, workers };
}

// Concurrent visits share only work in progress. No timer or scheduled checks.
let inFlight: { key: string; promise: Promise<WorkersResult> } | null = null;
export function fetchWorkers(): Promise<WorkersResult> {
  const config = loadConfig().workers;
  if (!config || config.workers.length === 0) return Promise.resolve({ checkedAt: Date.now(), durationMs: 0, pools: [], errors: [], workers: [] });
  const key = JSON.stringify(config);
  if (inFlight?.key === key) return inFlight.promise;
  const promise = collect(config);
  inFlight = { key, promise };
  void promise.finally(() => { if (inFlight?.promise === promise) inFlight = null; }).catch(() => {});
  return promise;
}
