import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { recordFailure } from "./failures";
import type { UsageFailure, UsageResult, UsageWindow } from "./types";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const EXTRA_HEADERS: Record<string, string> = {
  "anthropic-beta": "oauth-2025-04-20",
  "Content-Type": "application/json",
};
let cachedClaudeUserAgent: string | null = null;

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
const AUTH_RECOVERY_TTL_MS = 15_000;
const RATELIMIT_TTL_MS = 15 * 60_000;
const MAX_RATELIMIT_TTL_MS = 4 * 60 * 60_000;
let refreshRateLimitStreak = 0;
const rejectedAccessFingerprints = new Set<string>();
let inFlight: Promise<UsageResult> | null = null;
let cache: {
  at: number;
  ttl: number;
  result: UsageResult;
  // Credential generation observed when this fetch started. A newer valid
  // dashboard/Keychain/file credential can recover a cached auth failure.
  credentialFingerprint: string | null;
} | null = null;

// In-memory token state. We never write back to Claude Code's Keychain or
// ~/.claude/.credentials.json; rotated dashboard credentials use our own cache.
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
const OAUTH_CACHE_PATH = path.join(CACHE_DIR, "claude-oauth.json");

function isUsageWindow(w: unknown): w is UsageWindow {
  if (!w || typeof w !== "object") return false;
  const x = w as Record<string, unknown>;
  return typeof x.label === "string"
    && typeof x.usedPercent === "number" && Number.isFinite(x.usedPercent)
    && (x.resetAt === undefined
      || (typeof x.resetAt === "number" && Number.isFinite(x.resetAt)));
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
  if (typeof w.utilization !== "number" || !Number.isFinite(w.utilization)) return null;
  const reset = tsFrom(w.resets_at);
  const window: UsageWindow = { label, usedPercent: w.utilization, windowSecs };
  // Anthropic returns utilization: 0 with resets_at: null when a quota window
  // has no usage and therefore no reset scheduled. That is a valid live
  // snapshot, not a malformed response.
  if (reset != null) window.resetAt = reset;
  return window;
}

export function normalizeClaudeUsage(raw: unknown): UsageResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "response is not an object" };
  }
  const r = raw as Record<string, unknown>;
  // The OAuth usage API reports no window durations, so they're fixed here:
  // five_hour is 5h, seven_day is 7d. A reset timestamp may be absent for an
  // unused window; extract still returns its valid utilization in that case.
  const fiveHour = extract(r.five_hour, "5h", 5 * 3600);
  const weekly = extract(r.seven_day, "weekly", 7 * 24 * 3600);
  const windows = [fiveHour, weekly].filter((w): w is UsageWindow => w !== null);
  if (windows.length === 0) {
    return { ok: false, error: "no usable windows in response (five_hour and seven_day both missing or without numeric utilization)" };
  }
  return { ok: true, windows };
}

export async function fetchClaudeUsage(): Promise<UsageResult> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) {
    const cachedFetchFailed = !cache.result.ok || cache.result.staleReason != null;
    if (!cachedFetchFailed) return cache.result;

    // Claude Code may refresh its Keychain credential while this process is
    // backing off from an auth failure. Do not keep serving that stale failure
    // for the rest of the error/Retry-After TTL once a newer usable credential
    // is available.
    const currentCredential = loadStoredCreds();
    if (!hasNewerUsableCredential(cache.credentialFingerprint, currentCredential, now)) {
      return cache.result;
    }
  }

  // Multiple tabs/manual refreshes can arrive together. OAuth refresh tokens
  // rotate, so concurrent refreshes would race each other and invite 429s.
  // Share one in-flight fetch across every caller.
  if (inFlight) return inFlight;

  const credentialFingerprintAtStart = credentialFingerprint(loadStoredCreds());
  const request = doFetchClaudeUsage().then((fresh) => {
    cache = {
      at: now,
      ttl: fresh.ttl,
      result: fresh.result,
      credentialFingerprint: credentialFingerprintAtStart,
    };
    return fresh.result;
  });
  inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

type FetchResult = { result: UsageResult; ttl: number };

export type StoredOauth = { accessToken: string; refreshToken: string; expiresAt: number };

export function credentialFingerprint(credential: StoredOauth | null): string | null {
  if (!credential) return null;
  return createHash("sha256")
    .update(`${credential.expiresAt}\0${credential.accessToken}`)
    .digest("base64url")
    .slice(0, 16);
}

function accessTokenFingerprint(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("base64url").slice(0, 16);
}

function rememberRejectedAccessToken(accessToken: string): void {
  // Bound memory while remembering enough rotated tokens to avoid bouncing
  // between two rejected credential stores on every poll.
  if (rejectedAccessFingerprints.size >= 8) {
    const oldest = rejectedAccessFingerprints.values().next().value;
    if (typeof oldest === "string") rejectedAccessFingerprints.delete(oldest);
  }
  rejectedAccessFingerprints.add(accessTokenFingerprint(accessToken));
}

export function hasNewerUsableCredential(
  cachedFingerprint: string | null,
  current: StoredOauth | null,
  nowMs: number,
): boolean {
  return current != null
    && nowMs < current.expiresAt - REFRESH_SKEW_MS
    && credentialFingerprint(current) !== cachedFingerprint;
}

function parseOauth(value: unknown): StoredOauth | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.accessToken !== "string" || o.accessToken.length === 0) return null;
  if (typeof o.refreshToken !== "string" || o.refreshToken.length === 0) return null;
  if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) return null;
  return { accessToken: o.accessToken, refreshToken: o.refreshToken, expiresAt: o.expiresAt };
}

function parseStoredCreds(raw: string): StoredOauth | null {
  try {
    const root = JSON.parse(raw) as { claudeAiOauth?: unknown };
    return parseOauth(root.claudeAiOauth);
  } catch {
    return null;
  }
}

export function loadDashboardOauth(file = OAUTH_CACHE_PATH): StoredOauth | null {
  try {
    return parseOauth(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function persistDashboardOauth(oauth: StoredOauth, file = OAUTH_CACHE_PATH): void {
  const tempFile = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(oauth), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(tempFile, 0o600);
    fs.renameSync(tempFile, file);
  } catch {
    try { fs.unlinkSync(tempFile); } catch { /* best effort */ }
  }
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

function loadStoredCredentialCandidates(): StoredOauth[] {
  return [loadDashboardOauth(), readKeychainCreds(), readFileCreds()]
    .filter((candidate): candidate is StoredOauth => candidate !== null);
}

function loadStoredCreds(): StoredOauth | null {
  return pickFreshestCreds(loadStoredCredentialCandidates());
}

type TokenResult = { token: string } | { error: string; retryAfterMs?: number };

// Refresh tokens rotate: after either this process or the Claude Code CLI
// refreshes, only the most recently issued credential's refresh token is
// guaranteed live. Try freshest-first (by expiresAt) and keep the older one
// as a fallback in case the fresher one has been rotated out server-side.
export function orderRefreshTokens(
  mem: { refreshToken: string; expiresAt: number } | null,
  stored: { refreshToken: string; expiresAt: number },
): string[] {
  return orderRefreshCredentialTokens([mem, stored]);
}

export function orderRefreshCredentialTokens(
  candidates: ({ refreshToken: string; expiresAt: number } | null)[],
): string[] {
  const ordered = candidates
    .filter((candidate): candidate is { refreshToken: string; expiresAt: number } => candidate !== null)
    .sort((a, b) => b.expiresAt - a.expiresAt)
    .map((candidate) => candidate.refreshToken);
  return [...new Set(ordered)];
}

async function getValidToken(rejectedAccessToken?: string): Promise<TokenResult> {
  // Re-read storage even when memory is still valid: Claude Code may have
  // rotated a newer credential in the meantime. On a 401, exclude the token
  // that just failed so recovery uses a different stored token or refreshes.
  const stored = loadStoredCredentialCandidates();
  const now = Date.now();
  const usable = pickFreshestCreds([memToken, ...stored].filter((candidate) =>
    candidate != null
      && candidate.accessToken !== rejectedAccessToken
      && !rejectedAccessFingerprints.has(accessTokenFingerprint(candidate.accessToken))
      && now < candidate.expiresAt - REFRESH_SKEW_MS
  ));
  if (usable) {
    memToken = { ...usable };
    return { token: usable.accessToken };
  }

  // Even a rejected/expired access token can carry a usable refresh token.
  const refreshTokens = orderRefreshCredentialTokens([memToken, ...stored]);
  if (refreshTokens.length === 0) {
    return { error: "cannot read Claude credentials (no dashboard cache, Keychain item, or ~/.claude/.credentials.json)" };
  }

  // Token is expired (or near it) — refresh against the OAuth provider,
  // falling through to the next candidate when one is rejected outright.
  let lastError = "no refresh token available";
  for (const refreshToken of refreshTokens) {
    const attempt = await refreshAccessToken(refreshToken);
    if ("token" in attempt) return { token: attempt.token };
    if (attempt.stop) return { error: attempt.error, retryAfterMs: attempt.retryAfterMs };
    lastError = attempt.error;
  }
  return { error: lastError };
}

type RefreshAttempt =
  | { token: string }
  // stop: don't try further candidates (rate limit or network failure —
  // neither is specific to the token that was sent).
  | { error: string; stop: boolean; retryAfterMs?: number };

export async function refreshAccessToken(refreshToken: string): Promise<RefreshAttempt> {
  // Match Claude Code's current OAuth client: Anthropic's token endpoint
  // expects a JSON body for refresh-token exchanges.
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": getClaudeUserAgent(),
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        scope: OAUTH_SCOPE,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 429) {
      // Honor Retry-After. Without one, progressively back off repeated
      // failures so a prolonged outage cannot turn into a 15-minute hammer.
      const ttl = calculateRateLimitBackoff(
        parseRetryAfter(res.headers.get("Retry-After")),
        refreshRateLimitStreak,
      );
      refreshRateLimitStreak += 1;
      const retryAt = new Date(Date.now() + ttl).toLocaleTimeString();
      return { error: `token refresh rate limited — retrying after ${retryAt}`, stop: true, retryAfterMs: ttl };
    }
    if (!res.ok) {
      // Token-specific rejection (e.g. invalid_grant on a rotated-out
      // refresh token) — let the caller try the next candidate.
      let detail = "";
      try { detail = describeError(await res.json()); } catch { /* not JSON */ }
      return { error: `token refresh HTTP ${res.status}${detail}`, stop: false };
    }
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!body.access_token || !body.expires_in) return { error: "malformed token refresh response", stop: false };
    memToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      refreshToken: body.refresh_token ?? refreshToken,
    };
    // Keep the dashboard's rotated credential in its own private cache. Do
    // not mutate Claude Code's Keychain/file; whichever source refreshes next
    // simply becomes the freshest candidate.
    persistDashboardOauth(memToken);
    refreshRateLimitStreak = 0;
    return { token: memToken.accessToken };
  } catch (e) {
    // Network failure / timeout — not token-specific, so retrying the next
    // candidate would just double the latency. Bail for this cycle.
    return { error: `token refresh failed: ${(e as Error).message}`, stop: true };
  }
}

export function claudeUserAgentFromVersion(versionOutput: string): string {
  const version = versionOutput.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
  return version ? `claude-code/${version}` : "claude-code/life-dashboard";
}

function getClaudeUserAgent(): string {
  if (cachedClaudeUserAgent) return cachedClaudeUserAgent;
  try {
    const version = execFileSync("claude", ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    cachedClaudeUserAgent = claudeUserAgentFromVersion(version);
  } catch {
    cachedClaudeUserAgent = "claude-code/life-dashboard";
  }
  return cachedClaudeUserAgent;
}

export function calculateRateLimitBackoff(retryAfterMs: number | null, streak: number): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    return retryAfterMs;
  }
  const exponent = Math.max(0, Math.min(streak, 4));
  return Math.min(RATELIMIT_TTL_MS * (2 ** exponent), MAX_RATELIMIT_TTL_MS);
}

// Recent fetch failures, surfaced in the API payload so the UI can show a
// small error history alongside the gauges. In-memory only; resets on restart.
let failureLog: UsageFailure[] = [];

async function doFetchClaudeUsage(): Promise<FetchResult> {
  const fresh = await fetchFresh();

  if (fresh.result.ok) {
    // Cache a copy of the windows so future failures can fall back to this,
    // in memory and on disk (to survive restarts).
    lastGood = { atMs: Date.now(), windows: fresh.result.windows };
    persistLastGood(lastGood);
    return withFailures(fresh);
  }

  // Failure: log it — the stale fallback below otherwise hides the reason
  // entirely, which makes outages undiagnosable from pm2 logs.
  console.error(`[claude-usage] fetch failed: ${fresh.result.error}`);
  failureLog = recordFailure(failureLog, fresh.result.error, Math.floor(Date.now() / 1000));

  // Seed from disk if this process hasn't fetched successfully yet (e.g. right
  // after a dev-server restart) so the dashboard shows stale data, not blank.
  if (!lastGood) lastGood = loadLastGoodFromDisk();
  return withFailures(applyStaleFallback(fresh, lastGood, Date.now()));
}

function withFailures(fetch: FetchResult): FetchResult {
  if (failureLog.length === 0) return fetch;
  return { ...fetch, result: { ...fetch.result, failures: failureLog } };
}

// On failure, serve a recent successful snapshot with snapshotAt so the UI
// renders its stale treatment ("stale · Xm old"), carrying the underlying
// error as staleReason so the UI can say why. Keeps the original error TTL
// so back-off windows aren't bypassed.
export function applyStaleFallback(
  fresh: FetchResult,
  lastGood: LastGood | null,
  nowMs: number,
): FetchResult {
  if (fresh.result.ok) return fresh;
  if (!lastGood || nowMs - lastGood.atMs >= MAX_STALE_MS) return fresh;
  return {
    result: {
      ok: true,
      windows: lastGood.windows,
      snapshotAt: Math.floor(lastGood.atMs / 1000),
      staleReason: fresh.result.error,
    },
    ttl: fresh.ttl,
  };
}

async function fetchFresh(): Promise<FetchResult> {
  const t = await getValidToken();
  if ("error" in t) return { result: { ok: false, error: t.error }, ttl: t.retryAfterMs ?? ERROR_TTL_MS };

  return fetchUsageWithToken(t.token, true);
}

export async function fetchUsageWithToken(
  token: string,
  allowAuthRecovery: boolean,
  recoverToken: (rejectedAccessToken?: string) => Promise<TokenResult> = getValidToken,
): Promise<FetchResult> {
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": getClaudeUserAgent(), ...EXTRA_HEADERS },
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
      rememberRejectedAccessToken(token);
      if (allowAuthRecovery) {
        // Token rotation can invalidate an otherwise unexpired access token.
        // Re-read storage or refresh, then retry this usage request once in the
        // same dashboard refresh instead of caching a five-minute failure.
        try { await res.body?.cancel(); } catch { /* best effort */ }
        const recovered = await recoverToken(token);
        if ("token" in recovered) return fetchUsageWithToken(recovered.token, false, recoverToken);
        if (memToken?.accessToken === token) memToken = null;
        return {
          result: { ok: false, error: `automatic token recovery failed: ${recovered.error}` },
          ttl: recovered.retryAfterMs ?? ERROR_TTL_MS,
        };
      }
      if (memToken?.accessToken === token) memToken = null;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = describeError(await res.json()); } catch { /* not JSON */ }
      return {
        result: { ok: false, error: `usage endpoint HTTP ${res.status}${detail}` },
        ttl: res.status === 401 ? AUTH_RECOVERY_TTL_MS : ERROR_TTL_MS,
      };
    }
    refreshRateLimitStreak = 0;
    return { result: normalizeClaudeUsage(await res.json()), ttl: SUCCESS_TTL_MS };
  } catch (e) {
    return { result: { ok: false, error: `usage endpoint fetch failed: ${(e as Error).message}` }, ttl: ERROR_TTL_MS };
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
