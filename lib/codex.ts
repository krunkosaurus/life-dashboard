import { spawn } from "node:child_process";
import type { UsageResult, UsageWindow } from "./types";

// Codex ≥ 0.135 no longer persists rate-limit events to ~/.codex/logs_2.sqlite.
// The TUI fetches them live over the app-server JSON-RPC method
// `account/rateLimits/read`. We do the same: spawn `codex app-server`, perform
// the handshake, read the one snapshot, and map it onto our UsageWindow shape.

type AppServerWindow = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type RateLimitsResult = {
  rateLimits?: { primary?: AppServerWindow; secondary?: AppServerWindow };
};

// Validate one app-server window has finite numeric fields before trusting it.
// Fields can be present but null (e.g. before any usage), which would otherwise
// crash the client at `usedPercent.toFixed`.
function mapWindow(w: AppServerWindow | undefined, label: string): UsageWindow | null {
  if (!w) return null;
  if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return null;
  if (typeof w.resetsAt !== "number" || !Number.isFinite(w.resetsAt)) return null;
  const win: UsageWindow = { label, usedPercent: w.usedPercent, resetAt: w.resetsAt };
  // Duration can be null/missing (older codex builds); omit windowSecs so the
  // UI simply skips the elapsed bar rather than rendering garbage.
  if (typeof w.windowDurationMins === "number" && Number.isFinite(w.windowDurationMins)) {
    win.windowSecs = w.windowDurationMins * 60;
  }
  return win;
}

// Pure mapping from an `account/rateLimits/read` result onto UsageResult.
// Exported for testing. `snapshotAt` is unix seconds.
export function parseRateLimitsResult(result: unknown, snapshotAt: number): UsageResult {
  const rl = (result as RateLimitsResult)?.rateLimits;
  if (!rl?.primary || !rl?.secondary) {
    return { ok: false, error: "missing primary/secondary rate-limit windows" };
  }
  const primary = mapWindow(rl.primary, "5h");
  const secondary = mapWindow(rl.secondary, "weekly");
  if (!primary || !secondary) {
    return { ok: false, error: "primary/secondary window missing numeric usedPercent or resetsAt" };
  }
  return { ok: true, snapshotAt, windows: [primary, secondary] };
}

const RPC_TIMEOUT_MS = 15000;

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

    const finish = (r: UsageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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

    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.stdout?.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: unknown };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2) {
          const snapshotAt = Math.floor(Date.now() / 1000);
          finish(parseRateLimitsResult(msg.result, snapshotAt));
        }
      }
    });

    const send = (o: unknown) => child.stdin?.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "life-dashboard", version: "0.0.0" }, capabilities: {} } });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
  });
}
