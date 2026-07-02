import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { OuraActivitySummary, OuraResult, OuraSleepSummary } from "./types";

const API_BASE = "https://api.ouraring.com";
const AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = `${API_BASE}/oauth/token`;
const FETCH_TIMEOUT_MS = 10_000;
const SUCCESS_TTL_MS = 60_000;
const REFRESH_SKEW_MS = 60_000;
const OURA_SCOPES = ["daily"];

let cache: { at: number; result: OuraResult } | null = null;
let refreshInFlight: Promise<TokenResult> | null = null;

type OuraOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OuraTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
};

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; connectUrl?: string; retryAfterSeconds?: number };

type OuraDocumentResponse<T> = {
  data?: T[];
  next_token?: string | null;
};

type OuraDailySleepDoc = {
  day?: unknown;
  score?: unknown;
  timestamp?: unknown;
};

type OuraSleepDoc = {
  day?: unknown;
  type?: unknown;
  bedtime_start?: unknown;
  bedtime_end?: unknown;
  total_sleep_duration?: unknown;
  time_in_bed?: unknown;
  efficiency?: unknown;
  deep_sleep_duration?: unknown;
  rem_sleep_duration?: unknown;
  light_sleep_duration?: unknown;
  awake_time?: unknown;
};

type OuraDailyActivityDoc = {
  day?: unknown;
  steps?: unknown;
  score?: unknown;
  active_calories?: unknown;
  target_calories?: unknown;
  timestamp?: unknown;
};

type OuraStatsOptions = {
  day?: string;
  dayOffset?: number;
  now?: Date;
};

function cacheDir(): string {
  return process.env.OURA_CACHE_DIR || path.join(process.cwd(), ".cache");
}

function tokenPath(): string {
  return process.env.OURA_TOKEN_PATH || path.join(cacheDir(), "oura-token.json");
}

export function defaultOuraRedirectUri(requestUrl?: string): string {
  const origin = requestUrl
    ? new URL(requestUrl).origin
    : `http://127.0.0.1:${process.env.PORT || "3000"}`;
  return `${origin}/api/oura/callback`;
}

function getOuraConfig(requestUrl?: string): OuraOAuthConfig | null {
  const clientId = process.env.OURA_CLIENT_ID?.trim();
  const clientSecret = process.env.OURA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.OURA_REDIRECT_URI?.trim() || defaultOuraRedirectUri(requestUrl),
  };
}

function configuredClientId(): string | null {
  return process.env.OURA_CLIENT_ID?.trim() || null;
}

export function ouraTimeZone(): string {
  return process.env.OURA_TIME_ZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function ymdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ouraDateRange(now = new Date(), timeZone = ouraTimeZone()): {
  today: string;
  yesterday: string;
} {
  const today = ymdInTimeZone(now, timeZone);
  return { today, yesterday: addDaysYmd(today, -1) };
}

export function selectedOuraDay(
  options: Pick<OuraStatsOptions, "day" | "dayOffset"> = {},
  now = new Date(),
  timeZone = ouraTimeZone(),
): string {
  const { today } = ouraDateRange(now, timeZone);
  if (typeof options.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.day) && options.day <= today) {
    return options.day;
  }
  const offset = typeof options.dayOffset === "number" && Number.isFinite(options.dayOffset)
    ? Math.min(0, Math.trunc(options.dayOffset))
    : 0;
  return addDaysYmd(today, offset);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asInteger(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n == null ? null : Math.trunc(n);
}

function sortByDayThenTimestampDesc<T extends { day?: unknown; timestamp?: unknown }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const dayCmp = String(asString(b.day) ?? "").localeCompare(String(asString(a.day) ?? ""));
    if (dayCmp !== 0) return dayCmp;
    return String(asString(b.timestamp) ?? "").localeCompare(String(asString(a.timestamp) ?? ""));
  });
}

export function selectDailySleep(docs: OuraDailySleepDoc[], today: string): OuraDailySleepDoc | null {
  return sortByDayThenTimestampDesc(docs).find(d => asString(d.day) === today) ?? null;
}

export function selectPrimarySleep(docs: OuraSleepDoc[], day: string | null, today: string): OuraSleepDoc | null {
  const validTypes = new Set(["sleep", "long_sleep", "late_nap"]);
  const candidates = docs.filter(d => {
    const docDay = asString(d.day);
    const type = asString(d.type);
    return docDay != null && docDay <= today && (!type || validTypes.has(type)) && (!day || docDay === day);
  });
  return candidates.sort((a, b) => {
    if (!day) {
      const dayCmp = String(asString(b.day) ?? "").localeCompare(String(asString(a.day) ?? ""));
      if (dayCmp !== 0) return dayCmp;
    }
    const aLong = asString(a.type) === "long_sleep" ? 1 : 0;
    const bLong = asString(b.type) === "long_sleep" ? 1 : 0;
    if (aLong !== bLong) return bLong - aLong;
    const durationCmp = (asInteger(b.total_sleep_duration) ?? 0) - (asInteger(a.total_sleep_duration) ?? 0);
    if (durationCmp !== 0) return durationCmp;
    return String(asString(b.bedtime_end) ?? "").localeCompare(String(asString(a.bedtime_end) ?? ""));
  })[0] ?? null;
}

export function selectDailyActivity(docs: OuraDailyActivityDoc[], today: string): OuraDailyActivityDoc | null {
  return sortByDayThenTimestampDesc(docs).find(d => asString(d.day) === today) ?? null;
}

export function summarizeOuraDocuments(
  dailySleepDocs: OuraDailySleepDoc[],
  sleepDocs: OuraSleepDoc[],
  activityDocs: OuraDailyActivityDoc[],
  day: string,
  timeZone = ouraTimeZone(),
): Pick<Extract<OuraResult, { ok: true }>, "day" | "sleep" | "activity" | "timeZone"> {
  const dailySleep = selectDailySleep(dailySleepDocs, day);
  const sleepDay = asString(dailySleep?.day);
  const primarySleep = selectPrimarySleep(sleepDocs, sleepDay ?? day, day);
  const activity = selectDailyActivity(activityDocs, day);

  const sleep: OuraSleepSummary | null = sleepDay || primarySleep ? {
    day: sleepDay ?? asString(primarySleep?.day) ?? day,
    score: asInteger(dailySleep?.score),
    bedtimeStart: asString(primarySleep?.bedtime_start),
    bedtimeEnd: asString(primarySleep?.bedtime_end),
    totalSleepSeconds: asInteger(primarySleep?.total_sleep_duration),
    timeInBedSeconds: asInteger(primarySleep?.time_in_bed),
    efficiency: asInteger(primarySleep?.efficiency),
    deepSleepSeconds: asInteger(primarySleep?.deep_sleep_duration),
    remSleepSeconds: asInteger(primarySleep?.rem_sleep_duration),
    lightSleepSeconds: asInteger(primarySleep?.light_sleep_duration),
    awakeSeconds: asInteger(primarySleep?.awake_time),
  } : null;

  const activitySummary: OuraActivitySummary | null = activity ? {
    day: asString(activity.day) ?? day,
    steps: asInteger(activity.steps) ?? 0,
    score: asInteger(activity.score),
    activeCalories: asInteger(activity.active_calories),
    targetCalories: asInteger(activity.target_calories),
    timestamp: asString(activity.timestamp),
  } : null;

  return { day, sleep, activity: activitySummary, timeZone };
}

function readToken(): OuraTokenState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenPath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.accessToken !== "string" || typeof o.refreshToken !== "string" || typeof o.expiresAt !== "number") {
      return null;
    }
    return {
      accessToken: o.accessToken,
      refreshToken: o.refreshToken,
      expiresAt: o.expiresAt,
      ...(typeof o.scope === "string" ? { scope: o.scope } : {}),
    };
  } catch {
    return null;
  }
}

function writeToken(token: OuraTokenState): void {
  const file = tokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(token), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function tokenFromResponse(body: Record<string, unknown>, fallbackRefreshToken?: string): OuraTokenState | null {
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  const expiresIn = asInteger(body.expires_in);
  if (!accessToken || !expiresIn) return null;
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : fallbackRefreshToken;
  if (!refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
  };
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined;
}

function basicAuth(config: OuraOAuthConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

async function postToken(params: URLSearchParams, config: OuraOAuthConfig): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as Record<string, unknown>;
      const message = typeof body.error_description === "string"
        ? body.error_description
        : typeof body.error === "string"
        ? body.error
        : "";
      if (message) detail = ` (${message})`;
    } catch {
      // Ignore malformed error bodies; status is enough.
    }
    const retry = retryAfterSeconds(res);
    const suffix = retry != null ? `; retry after ${retry}s` : "";
    throw new Error(`token HTTP ${res.status}${detail}${suffix}`);
  }
  return await res.json() as Record<string, unknown>;
}

export async function exchangeOuraAuthorizationCode(
  code: string,
  requestUrl?: string,
  redirectUri?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getOuraConfig(requestUrl);
  if (!config) return { ok: false, error: "missing Oura OAuth config" };
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || config.redirectUri,
  });
  try {
    const body = await postToken(params, config);
    const token = tokenFromResponse(body);
    if (!token) return { ok: false, error: "malformed token response" };
    writeToken(token);
    cache = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function refreshAccessToken(config: OuraOAuthConfig, stored: OuraTokenState): Promise<TokenResult> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });
  try {
    const body = await postToken(params, config);
    const token = tokenFromResponse(body, stored.refreshToken);
    if (!token) return { ok: false, error: "malformed token refresh response", connectUrl: "/api/oura/connect" };
    writeToken(token);
    return { ok: true, token: token.accessToken };
  } catch (e) {
    return { ok: false, error: `token refresh failed: ${(e as Error).message}`, connectUrl: "/api/oura/connect" };
  }
}

async function validAccessToken(requestUrl?: string): Promise<TokenResult> {
  const config = getOuraConfig(requestUrl);
  if (!config) return { ok: false, error: "no Oura OAuth config", connectUrl: "/api/oura/connect" };

  const stored = readToken();
  if (!stored) return { ok: false, error: "Oura not connected", connectUrl: "/api/oura/connect" };
  if (Date.now() < stored.expiresAt - REFRESH_SKEW_MS) return { ok: true, token: stored.accessToken };

  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(config, stored).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function fetchOuraCollection<T>(
  endpoint: "daily_sleep" | "sleep" | "daily_activity",
  token: string,
  params: Record<string, string>,
): Promise<T[]> {
  const qs = new URLSearchParams(params);
  const url = `${API_BASE}/v2/usercollection/${endpoint}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const retry = retryAfterSeconds(res);
    const suffix = retry != null ? `; retry after ${retry}s` : "";
    throw new Error(`Oura ${endpoint} HTTP ${res.status}${suffix}`);
  }
  const body = await res.json() as OuraDocumentResponse<T>;
  if (!Array.isArray(body.data)) throw new Error(`Oura ${endpoint} returned unexpected response shape`);
  return body.data;
}

export async function fetchOuraStats(requestUrl?: string, options: OuraStatsOptions = {}): Promise<OuraResult> {
  if (!configuredClientId()) {
    return { ok: false, error: "no Oura configured", hidden: true };
  }

  const timeZone = ouraTimeZone();
  const now = options.now ?? new Date();
  const day = selectedOuraDay(options, now, timeZone);
  const previousDay = addDaysYmd(day, -1);
  if (cache && cache.result.ok && cache.result.day === day && Date.now() - cache.at < SUCCESS_TTL_MS) return cache.result;

  const token = await validAccessToken(requestUrl);
  if (!token.ok) {
    return {
      ok: false,
      error: token.error,
      ...(token.connectUrl ? { connectUrl: token.connectUrl } : {}),
      ...(token.retryAfterSeconds != null ? { retryAfterSeconds: token.retryAfterSeconds } : {}),
    };
  }

  try {
    const [dailySleep, sleep, activity] = await Promise.all([
      fetchOuraCollection<OuraDailySleepDoc>("daily_sleep", token.token, { start_date: previousDay, end_date: day }),
      fetchOuraCollection<OuraSleepDoc>("sleep", token.token, { start_date: previousDay, end_date: day }),
      fetchOuraCollection<OuraDailyActivityDoc>("daily_activity", token.token, { start_date: previousDay, end_date: day }),
    ]);
    const mapped = summarizeOuraDocuments(dailySleep, sleep, activity, day, timeZone);
    const result: OuraResult = { ok: true, ...mapped, checkedAt: Math.floor(Date.now() / 1000) };
    cache = { at: Date.now(), result };
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function buildOuraAuthorizeUrl(requestUrl: string, state: string): string | null {
  const clientId = configuredClientId();
  if (!clientId) return null;
  const redirectUri = process.env.OURA_REDIRECT_URI?.trim() || defaultOuraRedirectUri(requestUrl);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OURA_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export function newOauthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}
