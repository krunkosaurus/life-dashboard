import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { UsageResult, UsageWindow } from "./types";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const EXTRA_HEADERS: Record<string, string> = {
  "anthropic-beta": "oauth-2025-04-20",
  "Content-Type": "application/json",
  "User-Agent": "claude-code/2.1.33",
};

const CREDS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers";
const REFRESH_SKEW_MS = 60_000; // refresh tokens 1 minute before stated expiry

// Cache TTLs. Each cache entry carries its own ttl so 429 responses can
// honor Retry-After while ordinary success / error cases use sensible
// defaults.
const SUCCESS_TTL_MS  = 90_000;
const ERROR_TTL_MS    = 5 * 60_000;
const RATELIMIT_TTL_MS = 15 * 60_000;
let cache: { at: number; ttl: number; result: UsageResult } | null = null;

// In-memory token state. We never write back to ~/.claude/.credentials.json
// to avoid racing with the Claude Code CLI.
let memToken: { accessToken: string; expiresAt: number; refreshToken: string } | null = null;

// Last successful fetch — used as a fallback when a current fetch fails so
// the dashboard can show "stale, last seen X ago" rather than going blank.
// Capped so the UI doesn't display ancient data forever. Persisted to disk so
// it survives process/dev-server restarts (the in-memory copy is lost on every
// reload, which is why a fresh boot with an expired token went blank).
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
type LastGood = { atMs: number; windows: UsageWindow[] };
let lastGood: LastGood | null = null;

const CACHE_DIR = process.env.CLAUDE_CACHE_DIR || path.join(process.cwd(), ".cache");
const LAST_GOOD_PATH = path.join(CACHE_DIR, "claude-last-good.json");

function isUsageWindow(w: unknown): w is UsageWindow {
  if (!w || typeof w !== "object") return false;
  const x = w as Record<string, unknown>;
  return typeof x.label === "string"
    && typeof x.usedPercent === "number" && Number.isFinite(x.usedPercent)
    && typeof x.resetAt === "number" && Number.isFinite(x.resetAt);
}

export function persistLastGood(lg: LastGood, file = LAST_GOOD_PATH): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(lg));
  } catch { /* best-effort cache; never fail the request over it */ }
}

export function loadLastGoodFromDisk(file = LAST_GOOD_PATH): LastGood | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.atMs !== "number" || !Number.isFinite(p.atMs)) return null;
    if (!Array.isArray(p.windows) || !p.windows.every(isUsageWindow)) return null;
    return { atMs: p.atMs, windows: p.windows as UsageWindow[] };
  } catch {
    return null;
  }
}

// Extract a human-readable error from an OAuth/Anthropic error body.
// Handles both the flat OAuth shape `{ error, error_description }` and
// Anthropic's nested shape `{ type: "error", error: { type, message } }`.
function describeError(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  if (typeof b.error === "string") {
    const desc = typeof b.error_description === "string" ? `: ${b.error_description}` : "";
    return ` (${b.error}${desc})`;
  }
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    const t = typeof e.type === "string" ? e.type : "error";
    const m = typeof e.message === "string" ? `: ${e.message}` : "";
    return ` (${t}${m})`;
  }
  return "";
}

type Window = { utilization?: number | null; resets_at?: string | number | null };

function tsFrom(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
}

function extract(v: unknown, label: string, windowSecs: number): UsageWindow | null {
  if (!v || typeof v !== "object") return null;
  const w = v as Window;
  if (typeof w.utilization !== "number") return null;
  const reset = tsFrom(w.resets_at);
  if (reset == null) return null;
  return { label, usedPercent: w.utilization, resetAt: reset, windowSecs };
}

export function normalizeClaudeUsage(raw: unknown): UsageResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "response is not an object" };
  }
  const r = raw as Record<string, unknown>;
  // The OAuth usage API reports no window durations, so they're fixed here:
  // five_hour is 5h, seven_day is 7d.
  const fiveHour = extract(r.five_hour, "5h", 5 * 3600);
  const weekly = extract(r.seven_day, "weekly", 7 * 24 * 3600);
  const windows = [fiveHour, weekly].filter((w): w is UsageWindow => w !== null);
  if (windows.length === 0) {
    return { ok: false, error: "no usable windows in response (five_hour and seven_day both null or malformed)" };
  }
  return { ok: true, windows };
}

export async function fetchClaudeUsage(): Promise<UsageResult> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.result;
  const fresh = await doFetchClaudeUsage();
  cache = { at: now, ttl: fresh.ttl, result: fresh.result };
  return fresh.result;
}

type FetchResult = { result: UsageResult; ttl: number };

type StoredOauth = { accessToken: string; refreshToken: string; expiresAt: number };

function parseStoredCreds(raw: string): StoredOauth | null {
  let o: { accessToken?: string; refreshToken?: string; expiresAt?: number } | undefined;
  try {
    o = (JSON.parse(raw) as { claudeAiOauth?: typeof o }).claudeAiOauth;
  } catch {
    return null;
  }
  if (!o?.accessToken || !o?.refreshToken || !o?.expiresAt) return null;
  return { accessToken: o.accessToken, refreshToken: o.refreshToken, expiresAt: o.expiresAt };
}

// Most recently refreshed credential wins: it has the latest expiresAt and so
// the freshest (least likely to be rotated-out) refresh_token.
export function pickFreshestCreds(candidates: (StoredOauth | null)[]): StoredOauth | null {
  const valid = candidates.filter((c): c is StoredOauth => c !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (c.expiresAt > best.expiresAt ? c : best));
}

function readKeychainCreds(): StoredOauth | null {
  // macOS Claude Code stores live credentials in the login Keychain under the
  // service "Claude Code-credentials" and may leave the JSON file frozen at an
  // old token. Read the Keychain so the dashboard tracks the CLI's current
  // token instead of being pinned to a stale file forever.
  if (process.platform !== "darwin") return null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    );
    return parseStoredCreds(raw);
  } catch {
    return null;
  }
}

function readFileCreds(): StoredOauth | null {
  try {
    return parseStoredCreds(fs.readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function loadStoredCreds(): StoredOauth | null {
  return pickFreshestCreds([readKeychainCreds(), readFileCreds()]);
}

type TokenResult = { token: string } | { error: string; retryAfterMs?: number };

async function getValidToken(): Promise<TokenResult> {
  // Use in-memory token if still valid.
  if (memToken && Date.now() < memToken.expiresAt - REFRESH_SKEW_MS) {
    return { token: memToken.accessToken };
  }

  // Seed (or re-seed) memory from the freshest stored credential.
  const oauth = loadStoredCreds();
  if (!oauth) {
    return { error: "cannot read Claude credentials (no Keychain item or ~/.claude/.credentials.json)" };
  }
  if (Date.now() < oauth.expiresAt - REFRESH_SKEW_MS) {
    memToken = { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt, refreshToken: oauth.refreshToken };
    return { token: oauth.accessToken };
  }

  // Token is expired (or near it) — refresh against the OAuth provider.
  // RFC 6749 §3.2 requires application/x-www-form-urlencoded for token
  // endpoint requests; sending JSON returns HTTP 400 invalid_request.
  const refreshToken = memToken?.refreshToken ?? oauth.refreshToken;
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "claude-code/2.1.33",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        scope: OAUTH_SCOPE,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 429) {
      // The refresh endpoint is rate limiting us. Back off for the full
      // Retry-After window (default 15m) instead of the 5m error TTL, so we
      // stop hammering and making it worse.
      const ttl = parseRetryAfter(res.headers.get("Retry-After")) ?? RATELIMIT_TTL_MS;
      const retryAt = new Date(Date.now() + ttl).toLocaleTimeString();
      return { error: `token refresh rate limited — retrying after ${retryAt}`, retryAfterMs: ttl };
    }
    if (!res.ok) {
      let detail = "";
      try { detail = describeError(await res.json()); } catch { /* not JSON */ }
      return { error: `token refresh HTTP ${res.status}${detail}` };
    }
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!body.access_token || !body.expires_in) return { error: "malformed token refresh response" };
    memToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      refreshToken: body.refresh_token ?? refreshToken,
    };
    return { token: memToken.accessToken };
  } catch (e) {
    return { error: `token refresh failed: ${(e as Error).message}` };
  }
}

async function doFetchClaudeUsage(): Promise<FetchResult> {
  const fresh = await fetchFresh();

  if (fresh.result.ok) {
    // Cache a copy of the windows so future failures can fall back to this,
    // in memory and on disk (to survive restarts).
    lastGood = { atMs: Date.now(), windows: fresh.result.windows };
    persistLastGood(lastGood);
    return fresh;
  }

  // Failure: if we have a recent successful snapshot, serve it with
  // snapshotAt so the UI renders its stale treatment ("stale · Xm old").
  // Keep the original error TTL so we don't bypass any back-off windows.
  // Seed from disk if this process hasn't fetched successfully yet (e.g. right
  // after a dev-server restart) so the dashboard shows stale data, not blank.
  if (!lastGood) lastGood = loadLastGoodFromDisk();
  if (lastGood && Date.now() - lastGood.atMs < MAX_STALE_MS) {
    return {
      result: { ok: true, windows: lastGood.windows, snapshotAt: Math.floor(lastGood.atMs / 1000) },
      ttl: fresh.ttl,
    };
  }
  return fresh;
}

async function fetchFresh(): Promise<FetchResult> {
  const t = await getValidToken();
  if ("error" in t) return { result: { ok: false, error: t.error }, ttl: t.retryAfterMs ?? ERROR_TTL_MS };

  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${t.token}`, ...EXTRA_HEADERS },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 429) {
      // Honor Retry-After if present (seconds or HTTP date); else back off
      // for the default rate-limit window. Either way we surface when the
      // dashboard will retry.
      const ra = res.headers.get("Retry-After");
      const retryAfterMs = parseRetryAfter(ra) ?? RATELIMIT_TTL_MS;
      const retryAt = new Date(Date.now() + retryAfterMs).toLocaleTimeString();
      return {
        result: { ok: false, error: `rate limited — retrying after ${retryAt}` },
        ttl: retryAfterMs,
      };
    }
    if (res.status === 401) {
      // Clear in-memory token so the next call re-reads from disk and
      // attempts a refresh.
      memToken = null;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = describeError(await res.json()); } catch { /* not JSON */ }
      return { result: { ok: false, error: `usage endpoint HTTP ${res.status}${detail}` }, ttl: ERROR_TTL_MS };
    }
    return { result: normalizeClaudeUsage(await res.json()), ttl: SUCCESS_TTL_MS };
  } catch (e) {
    return { result: { ok: false, error: `usage endpoint fetch failed: ${(e as Error).message}` }, ttl: ERROR_TTL_MS };
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 3600) * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
