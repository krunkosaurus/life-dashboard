import { spawn } from "node:child_process";
import { recordFailure } from "./failures";
import type { UsageFailure, UsageResult, UsageWindow } from "./types";

// Codex ≥ 0.135 no longer persists rate-limit events to ~/.codex/logs_2.sqlite.
// The TUI fetches them live over the app-server JSON-RPC method
// `account/rateLimits/read`. We do the same: spawn `codex app-server`, perform
// the handshake, read the one snapshot, and map it onto our UsageWindow shape.

type AppServerWindow = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type RateLimitSnapshot = {
  primary?: AppServerWindow | null;
  secondary?: AppServerWindow | null;
};

type RateLimitsResult = {
  rateLimits?: RateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
};

function windowLabel(durationMins: number | null | undefined, fallback: string): string {
  if (typeof durationMins !== "number" || !Number.isFinite(durationMins) || durationMins <= 0) {
    return fallback;
  }
  if (durationMins === 7 * 24 * 60) return "weekly";
  if (durationMins % (24 * 60) === 0) return `${durationMins / (24 * 60)}d`;
  if (durationMins % 60 === 0) return `${durationMins / 60}h`;
  return `${durationMins}m`;
}

// Validate one app-server window before trusting it. Current Codex versions
// make each window and its reset timestamp independently nullable, so a valid
// utilization can still be displayed when another window (or reset) is absent.
function mapWindow(w: AppServerWindow | null | undefined, fallbackLabel: string): UsageWindow | null {
  if (!w) return null;
  if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return null;
  if (w.resetsAt != null && (typeof w.resetsAt !== "number" || !Number.isFinite(w.resetsAt))) {
    return null;
  }
  const win: UsageWindow = {
    label: windowLabel(w.windowDurationMins, fallbackLabel),
    usedPercent: w.usedPercent,
  };
  if (typeof w.resetsAt === "number") win.resetAt = w.resetsAt;
  // Duration can be null/missing (older codex builds); omit windowSecs so the
  // UI simply skips the elapsed bar rather than rendering garbage.
  if (
    typeof w.windowDurationMins === "number"
    && Number.isFinite(w.windowDurationMins)
    && w.windowDurationMins > 0
  ) {
    win.windowSecs = w.windowDurationMins * 60;
  }
  return win;
}

// Pure mapping from an `account/rateLimits/read` result onto UsageResult.
// Exported for testing. `snapshotAt` is unix seconds.
export function parseRateLimitsResult(result: unknown, snapshotAt: number): UsageResult {
  const response = result as RateLimitsResult | null;
  const candidates = [
    response?.rateLimits,
    response?.rateLimitsByLimitId?.codex,
    ...Object.values(response?.rateLimitsByLimitId ?? {}),
  ].filter((candidate, index, all): candidate is RateLimitSnapshot =>
    candidate != null && all.indexOf(candidate) === index
  );
  if (candidates.length === 0) {
    return { ok: false, error: "missing rate-limit snapshot" };
  }

  for (const rl of candidates) {
    const primary = mapWindow(rl.primary, "5h");
    const secondary = mapWindow(rl.secondary, "weekly");
    const windows = [primary, secondary].filter((w): w is UsageWindow => w !== null);
    if (windows.length > 0) {
      return { ok: true, snapshotAt, windows };
    }
  }
  return { ok: false, error: "rate-limit snapshot contains no usable windows" };
}

// Each read spawns a `codex app-server` process, so cache briefly to coalesce
// rapid polls (the auto-refresh tick, the manual refresh button, StrictMode's
// double-invoke, multiple open tabs) into one spawn, and back off on errors so a
// broken `codex` binary isn't respawned on every poll.
const SUCCESS_TTL_MS = 15_000;
const ERROR_TTL_MS = 60_000;
const MAX_STALE_MS = 24 * 60 * 60_000;
let cache: { at: number; ttl: number; result: UsageResult } | null = null;
let inFlight: Promise<UsageResult> | null = null;
let lastGood: Extract<UsageResult, { ok: true }> | null = null;

// Recent fetch failures, surfaced in the payload so the UI can show a small
// error history. In-memory only; resets on restart.
let failureLog: UsageFailure[] = [];

// Cached entry point for the API route: serves a recent snapshot when warm,
// otherwise spawns codex once, logging failures and attaching the history.
export async function fetchCodexRateLimit(): Promise<UsageResult> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.result;

  // Cache entries are written only after the app-server replies. Without a
  // separate in-flight gate, simultaneous tabs all miss the cache and each
  // spawn their own Codex process.
  if (inFlight) return inFlight;

  const request = readLatestCodexRateLimit().then((fresh) => {
    if (fresh.ok) {
      lastGood = fresh;
    } else {
      console.error(`[codex-usage] fetch failed: ${fresh.error}`);
      failureLog = recordFailure(failureLog, fresh.error, Math.floor(Date.now() / 1000));
    }

    const result: UsageResult = fresh.ok
      ? fresh
      : lastGood
        && lastGood.snapshotAt != null
        && Date.now() - lastGood.snapshotAt * 1000 < MAX_STALE_MS
        ? { ...lastGood, staleReason: fresh.error }
        : fresh;
    const withFailures = failureLog.length > 0 ? { ...result, failures: failureLog } : result;
    cache = {
      at: Date.now(),
      ttl: fresh.ok ? SUCCESS_TTL_MS : ERROR_TTL_MS,
      result: withFailures,
    };
    return withFailures;
  });
  inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

const RPC_TIMEOUT_MS = 15000;
const EMPTY_SNAPSHOT_RETRY_DELAYS_MS = [250, 750];

// Spawn `codex app-server`, run the JSON-RPC handshake, and resolve the live
// rate-limit snapshot. Never rejects — failures map onto { ok: false }.
export function readLatestCodexRateLimit(): Promise<UsageResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, error: `cannot spawn codex app-server: ${(e as Error).message}` });
      return;
    }

    let settled = false;
    let buf = "";
    let stderr = "";
    let readAttempt = 0;
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();

    const finish = (r: UsageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const retryTimer of retryTimers) clearTimeout(retryTimer);
      child.kill("SIGKILL");
      resolve(r);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `codex app-server timed out after ${RPC_TIMEOUT_MS}ms` });
    }, RPC_TIMEOUT_MS);

    child.on("error", (e) => {
      finish({ ok: false, error: `codex app-server failed: ${(e as Error).message} (is codex on PATH?)` });
    });
    child.on("close", (code) => {
      if (!settled) {
        const tail = stderr.trim().slice(-300);
        finish({ ok: false, error: `codex app-server exited (code ${code}) without a rate-limit reply${tail ? `: ${tail}` : ""}` });
      }
    });

    const send = (o: unknown) => child.stdin?.write(JSON.stringify(o) + "\n");
    const requestRateLimits = () => {
      readAttempt += 1;
      send({
        jsonrpc: "2.0",
        id: readAttempt + 1,
        method: "account/rateLimits/read",
        params: {},
      });
    };

    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.stdout?.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: {
          id?: number;
          result?: unknown;
          error?: { code?: number; message?: string };
        };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) {
            finish({
              ok: false,
              error: `codex app-server initialization failed: ${msg.error.message ?? `RPC ${msg.error.code ?? "error"}`}`,
            });
            continue;
          }
          // Initialization is ordered in JSON-RPC: wait for the response
          // before sending initialized and the first account read.
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          requestRateLimits();
          continue;
        }
        if (typeof msg.id === "number" && msg.id >= 2 && msg.id <= EMPTY_SNAPSHOT_RETRY_DELAYS_MS.length + 2) {
          if (msg.error) {
            finish({
              ok: false,
              error: `codex rate-limit read failed: ${msg.error.message ?? `RPC ${msg.error.code ?? "error"}`}`,
            });
            continue;
          }
          const snapshotAt = Math.floor(Date.now() / 1000);
          const parsed = parseRateLimitsResult(msg.result, snapshotAt);
          if (!parsed.ok && readAttempt <= EMPTY_SNAPSHOT_RETRY_DELAYS_MS.length) {
            const retryTimer = setTimeout(() => {
              retryTimers.delete(retryTimer);
              if (!settled) requestRateLimits();
            }, EMPTY_SNAPSHOT_RETRY_DELAYS_MS[readAttempt - 1]);
            retryTimers.add(retryTimer);
          } else {
            finish(parsed);
          }
        }
      }
    });

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "life-dashboard", version: "0.0.0" }, capabilities: {} } });
  });
}
