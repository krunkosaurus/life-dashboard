import { pbkdf2Sync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { loadConfig } from "./config";
import { recordFailure } from "./failures";
import type {
  LiveLogAuthInput,
  LiveLogBadge,
  LiveLogConfig,
  LiveLogDeriveInput,
  LiveLogEip712Input,
  LiveLogEvent,
  LiveLogResult,
  LiveLogSourceError,
  LiveLogSourceInput,
  LiveLogStat,
  LiveLogStatFormat,
  LiveLogStatGroupInput,
  UsageFailure,
} from "./types";

const FETCH_TIMEOUT_MS = 10_000;
// The dashboard polls every refreshSeconds (default 60s); cache successful
// fetches per source for the same beat so a poll never refans every request.
const SUCCESS_TTL_MS = 60_000;
// Re-login when the bearer token has less than this long left to live.
const TOKEN_SKEW_S = 600;
// Rows stamped further in the future than this are treated as bogus.
const FUTURE_SLACK_S = 300;
const DEFAULT_SOURCE_LIMIT = 50;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

function ymdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Expand ${...} time tokens (all UTC) inside a config value. Unknown tokens
// pass through untouched so typos are visible rather than silently blank.
export function substituteTokens(value: string, now: Date): string {
  return value.replace(
    /\$\{(today|yesterday|nowIso)\}|\$\{(ymdDaysAgo|isoDaysAgo|epochDaysAgo):(\d+(?:\.\d+)?)\}/g,
    (match, plain, fn, arg) => {
      if (plain === "today") return ymdUtc(now);
      if (plain === "yesterday") return ymdUtc(new Date(now.getTime() - DAY_MS));
      if (plain === "nowIso") return now.toISOString();
      const past = new Date(now.getTime() - Number(arg) * DAY_MS);
      if (fn === "ymdDaysAgo") return ymdUtc(past);
      if (fn === "isoDaysAgo") return past.toISOString();
      if (fn === "epochDaysAgo") return String(Math.floor(past.getTime() / 1000));
      return match;
    }
  );
}

// Resolve a dotted path with optional [key=value] array selectors, e.g.
// "data.byTerm[term=monthly].count". Returns undefined on any miss.
export function resolvePath(obj: unknown, pathExpr: string): unknown {
  let cur: unknown = obj;
  for (const segment of pathExpr.split(".")) {
    const m = segment.match(/^([^[\]]+)(?:\[([^=\]]+)=([^\]]*)\])?$/);
    if (!m) return undefined;
    const [, name, selKey, selValue] = m;
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[name];
    if (selKey !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find(
        el => el != null && typeof el === "object" && String((el as Record<string, unknown>)[selKey]) === selValue
      );
    }
  }
  return cur;
}

// Parse a timestamp of unknown unit into unix seconds: numbers are detected as
// seconds vs milliseconds by magnitude, strings fall back to Date.parse.
export function parseTime(value: unknown): number | null {
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
    const n = Number(value);
    if (n > 1e11) return Math.floor(n / 1000); // milliseconds
    if (n > 1e8) return Math.floor(n);         // seconds (1e8 ≈ 1973)
    return null;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
}

function formatFieldValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
  }
  return String(v);
}

// Render a "{field}" template against a row. Fields may use dotted paths
// ("{source.app}"). Missing fields render empty, then " · "-separated parts
// with no letters/digits left (e.g. a dangling "$") are dropped so partial
// rows read cleanly.
export function renderTemplate(template: string, row: Record<string, unknown>): string {
  const rendered = template.replace(/\{([^}]+)\}/g, (_, field: string) =>
    formatFieldValue(resolvePath(row, field.trim()))
  );
  return rendered
    .split(" · ")
    .map(part => part.trim())
    .filter(part => /[\p{L}\p{N}]/u.test(part))
    .join(" · ");
}

function variantMatches(row: Record<string, unknown>, when: { field: string; equals?: string | number | boolean; nonNull?: boolean }): boolean {
  const v = resolvePath(row, when.field);
  if (when.equals !== undefined && String(v) !== String(when.equals)) return false;
  if (when.nonNull !== undefined && (v != null) !== when.nonNull) return false;
  return true;
}

// First matching variant wins; defaults come from the source.
export function applyVariants(
  source: LiveLogSourceInput,
  row: Record<string, unknown>,
  defaultColor: string
): { label: string; color: string } {
  for (const variant of source.variants ?? []) {
    if (variantMatches(row, variant.when)) {
      return { label: variant.label ?? source.label, color: variant.color ?? source.color ?? defaultColor };
    }
  }
  return { label: source.label, color: source.color ?? defaultColor };
}

export function resolveBadges(source: LiveLogSourceInput, row: Record<string, unknown>): LiveLogBadge[] {
  const badges: LiveLogBadge[] = [];
  for (const badge of source.badges ?? []) {
    const v = resolvePath(row, badge.field);
    if (v == null || v === "") continue;
    let text: string;
    if (badge.map) {
      const mapped = badge.map[String(v)];
      if (mapped === undefined) continue; // mapped badges only chip known values
      text = mapped;
    } else {
      text = String(v);
    }
    badges.push(badge.color ? { text, color: badge.color } : { text });
  }
  return badges;
}

const DEFAULT_EVENT_COLOR = "#7aa2f7";

// Turn one source's raw rows into normalized feed events: window, sort desc,
// cap. Rows without a parseable in-window timestamp are dropped.
export function normalizeSourceRows(
  source: LiveLogSourceInput,
  rows: unknown[],
  now: Date,
  feedWindowHours: number
): LiveLogEvent[] {
  const nowS = Math.floor(now.getTime() / 1000);
  const windowHours = source.windowHours ?? feedWindowHours;
  const cutoff = nowS - windowHours * 3600;
  const events: LiveLogEvent[] = [];
  rows.forEach((raw, i) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return;
    const row = raw as Record<string, unknown>;
    const time = parseTime(resolvePath(row, source.time));
    if (time == null || time < cutoff || time > nowS + FUTURE_SLACK_S) return;
    const { label, color } = applyVariants(source, row, DEFAULT_EVENT_COLOR);
    const title = source.title ? renderTemplate(source.title, row) : "";
    const detail = source.detail ? renderTemplate(source.detail, row) : "";
    const value = source.value ? renderTemplate(source.value, row) : "";
    const event: LiveLogEvent = {
      id: `${source.id}:${time}:${title || label}:${i}`,
      sourceId: source.id,
      label,
      color,
      time,
      title: title || label,
      badges: resolveBadges(source, row),
    };
    if (detail) event.detail = detail;
    if (value) event.value = value;
    events.push(event);
  });
  events.sort((a, b) => b.time - a.time || (a.id < b.id ? -1 : 1));
  return events.slice(0, source.limit ?? DEFAULT_SOURCE_LIMIT);
}

export function mergeEvents(lists: LiveLogEvent[][], maxItems: number): LiveLogEvent[] {
  return lists
    .flat()
    .sort((a, b) => b.time - a.time || (a.id < b.id ? -1 : 1))
    .slice(0, maxItems);
}

export function formatStatValue(value: unknown, format: LiveLogStatFormat = "number"): string {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    return typeof value === "string" && value.trim() !== "" ? value : "—";
  }
  if (format === "usd") {
    const fractional = Math.abs(n % 1) > 1e-9;
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: fractional ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  }
  if (format === "percent") {
    // Rates may arrive as 0–1 or 0–100; treat ≤1 as a fraction.
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function extractStats(group: LiveLogStatGroupInput, json: unknown): LiveLogStat[] {
  return group.items.map(item => ({
    label: item.label,
    value: formatStatValue(resolvePath(json, item.path), item.format),
  }));
}

function normalizePrivateKey(privateKeyHex: string): Uint8Array {
  const pk = privateKeyHex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error("signing key is not a 32-byte hex string");
  return hexToBytes(pk);
}

// Sign a 32-byte digest and return the Ethereum wire format 0x‖r‖s‖v
// (v = 27 + recovery). Deterministic (RFC 6979), so tests can use vectors.
function signDigest(digest: Uint8Array, privateKeyHex: string): string {
  const sig = secp256k1.sign(digest, normalizePrivateKey(privateKeyHex), { prehash: false, format: "recovered" });
  return `0x${bytesToHex(sig.subarray(1))}${(27 + sig[0]).toString(16).padStart(2, "0")}`;
}

// EIP-191 personal_sign: keccak256("\x19Ethereum Signed Message:\n" + len + message).
export function personalSign(message: string, privateKeyHex: string): string {
  const prefixed = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${message.length}${message}`);
  return signDigest(keccak_256(prefixed), privateKeyHex);
}

// Derive a signing key from credentials via PBKDF2-SHA256 (32 bytes → hex).
export function deriveWalletKey(username: string, password: string, derive: Pick<LiveLogDeriveInput, "salt" | "iterations" | "lowercaseUsername">): string {
  const user = derive.lowercaseUsername === false ? username : username.toLowerCase();
  const key = pbkdf2Sync(Buffer.from(user + password, "utf8"), Buffer.from(derive.salt, "utf8"), derive.iterations ?? 10000, 32, "sha256");
  return `0x${key.toString("hex")}`;
}

// EIP-55 checksummed address of a private key's account.
export function addressFromPrivateKey(privateKeyHex: string): string {
  const pub = secp256k1.getPublicKey(normalizePrivateKey(privateKeyHex), false);
  const addr = bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let out = "0x";
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

const EIP712_DOMAIN_FIELDS: { key: "name" | "version" | "chainId" | "verifyingContract"; type: string }[] = [
  { key: "name", type: "string" },
  { key: "version", type: "string" },
  { key: "chainId", type: "uint256" },
  { key: "verifyingContract", type: "address" },
];

function encodeEip712Value(type: string, value: unknown): Uint8Array {
  if (type === "string") return keccak_256(new TextEncoder().encode(String(value)));
  if (type === "address") {
    const hex = String(value).trim().replace(/^0x/, "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`invalid address for EIP-712 field`);
    const out = new Uint8Array(32);
    out.set(hexToBytes(hex), 12);
    return out;
  }
  if (type === "uint256") {
    let n = BigInt(String(value));
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0 && n > 0n; i--) {
      out[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return out;
  }
  throw new Error(`unsupported EIP-712 field type: ${type}`);
}

function hashEip712Struct(typeName: string, fields: { name: string; type: string }[], values: Record<string, unknown>): Uint8Array {
  const signature = `${typeName}(${fields.map(f => `${f.type} ${f.name}`).join(",")})`;
  const encoded: Uint8Array[] = [keccak_256(new TextEncoder().encode(signature))];
  for (const field of fields) {
    encoded.push(encodeEip712Value(field.type, values[field.name]));
  }
  const buf = new Uint8Array(encoded.length * 32);
  encoded.forEach((chunk, i) => buf.set(chunk, i * 32));
  return keccak_256(buf);
}

// EIP-712 signTypedData for one flat struct (field types: address | string |
// uint256) — enough for authentication payloads without pulling in a web3 lib.
export function signTypedData(cfg: LiveLogEip712Input, message: Record<string, unknown>, privateKeyHex: string): string {
  const fields = cfg.types[cfg.primaryType];
  if (!fields) throw new Error(`EIP-712 types missing ${cfg.primaryType}`);
  const domainFields = EIP712_DOMAIN_FIELDS.filter(f => cfg.domain[f.key] !== undefined).map(f => ({ name: f.key, type: f.type }));
  const domainHash = hashEip712Struct("EIP712Domain", domainFields, cfg.domain as unknown as Record<string, unknown>);
  const structHash = hashEip712Struct(cfg.primaryType, fields, message);
  const digest = new Uint8Array(2 + 64);
  digest.set([0x19, 0x01], 0);
  digest.set(domainHash, 2);
  digest.set(structHash, 34);
  return signDigest(keccak_256(digest), privateKeyHex);
}

export function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session (bearer token) management
// ---------------------------------------------------------------------------

type Session = { token: string; exp: number | null };

let session: Session | null = null;
let sessionLoaded = false;
let loginInFlight: Promise<Session> | null = null;

function cacheDir(): string {
  return process.env.LIVELOG_CACHE_DIR || path.join(process.cwd(), ".cache");
}

function sessionPath(): string {
  return path.join(cacheDir(), "livelog-session.json");
}

function lastGoodPath(): string {
  return path.join(cacheDir(), "livelog-last-good.json");
}

// Atomic private write (temp file + rename), matching the Oura/Claude caches.
function writePrivateJson(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Cache persistence is best-effort; in-memory state still works.
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadSessionOnce(): void {
  if (sessionLoaded) return;
  sessionLoaded = true;
  const raw = readJson(sessionPath());
  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).token === "string") {
    const token = (raw as Record<string, unknown>).token as string;
    session = { token, exp: decodeJwtExp(token) };
  }
}

function tokenUsable(s: Session | null, nowS: number): s is Session {
  return s != null && s.token !== "" && (s.exp == null || s.exp - nowS > TOKEN_SKEW_S);
}

function baseHeaders(auth: LiveLogAuthInput | null): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (auth?.origin) {
    headers.origin = auth.origin;
    headers.referer = `${auth.origin}/`;
  }
  return headers;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    if (res.ok) throw new Error("invalid JSON response");
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object" && typeof (json as Record<string, unknown>).message === "string"
        ? `: ${((json as Record<string, unknown>).message as string).slice(0, 120)}`
        : "";
    const err = new Error(`HTTP ${res.status}${message}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json;
}

// Resolve the signing key: direct env var, or PBKDF2 derivation from
// credential env vars. Errors name the env var, never echo values.
function resolveSigningKey(auth: LiveLogAuthInput): string {
  if (auth.privateKeyEnv) {
    const pk = process.env[auth.privateKeyEnv];
    if (!pk) throw new Error(`missing ${auth.privateKeyEnv} in .env.local`);
    return pk;
  }
  if (auth.derive) {
    const username = process.env[auth.derive.usernameEnv];
    const password = process.env[auth.derive.passwordEnv];
    if (!username) throw new Error(`missing ${auth.derive.usernameEnv} in .env.local`);
    if (!password) throw new Error(`missing ${auth.derive.passwordEnv} in .env.local`);
    return deriveWalletKey(username, password, auth.derive);
  }
  throw new Error("auth has neither privateKeyEnv nor derive");
}

function buildLoginSignature(auth: LiveLogAuthInput, nonce: string, walletAddress: string, pk: string): string {
  const scheme = auth.signature ?? { scheme: "personal" as const };
  if (scheme.scheme === "personal") return personalSign(nonce, pk);
  const message: Record<string, unknown> = {};
  for (const [k, template] of Object.entries(scheme.message)) {
    message[k] = template.replaceAll("${nonce}", nonce).replaceAll("${walletAddress}", walletAddress);
  }
  return signTypedData(scheme, message, pk);
}

async function login(auth: LiveLogAuthInput): Promise<Session> {
  const pk = resolveSigningKey(auth);
  const walletAddress = auth.walletAddress ?? addressFromPrivateKey(pk);
  const headers = { ...baseHeaders(auth), "content-type": "application/json" };
  const nonceJson = await fetchJson(auth.nonceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ walletAddress }),
  });
  const nonce = resolvePath(nonceJson, auth.noncePath ?? "data.nonce");
  if (typeof nonce !== "string" && typeof nonce !== "number") throw new Error("login: no nonce in response");
  const loginJson = await fetchJson(auth.loginUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      walletAddress,
      signature: buildLoginSignature(auth, String(nonce), walletAddress, pk),
      rememberMe: true,
      ...auth.extraBody,
    }),
  });
  const token = resolvePath(loginJson, auth.tokenPath ?? "data.token");
  if (typeof token !== "string" || token === "") throw new Error("login: no token in response");
  const fresh: Session = { token, exp: decodeJwtExp(token) };
  session = fresh;
  writePrivateJson(sessionPath(), { token });
  return fresh;
}

async function ensureToken(auth: LiveLogAuthInput, nowS: number): Promise<Session> {
  loadSessionOnce();
  if (tokenUsable(session, nowS)) return session;
  if (!loginInFlight) {
    loginInFlight = login(auth).finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

async function authedGet(url: string, auth: LiveLogAuthInput | null, nowS: number): Promise<unknown> {
  const headers = baseHeaders(auth);
  if (auth) headers.authorization = `Bearer ${(await ensureToken(auth, nowS)).token}`;
  try {
    return await fetchJson(url, { headers });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (auth && (status === 401 || status === 403)) {
      // Token may be stale or revoked: drop it, log in again, retry once.
      session = null;
      headers.authorization = `Bearer ${(await ensureToken(auth, nowS)).token}`;
      return fetchJson(url, { headers });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cached fetching + last-good fallback
// ---------------------------------------------------------------------------

type CacheEntry<T> = { at: number; value: T };
type LastGood = {
  at: number;
  events: Record<string, LiveLogEvent[]>;
  stats: Record<string, LiveLogStat[]>;
};

const sourceCache = new Map<string, CacheEntry<LiveLogEvent[]>>();
const statsCache = new Map<string, CacheEntry<LiveLogStat[]>>();
let failures: UsageFailure[] = [];
let lastGood: LastGood | null = null;
let lastGoodLoaded = false;

function loadLastGoodOnce(): void {
  if (lastGoodLoaded) return;
  lastGoodLoaded = true;
  const raw = readJson(lastGoodPath());
  if (raw && typeof raw === "object" && typeof (raw as LastGood).at === "number") {
    const lg = raw as LastGood;
    lastGood = {
      at: lg.at,
      events: lg.events && typeof lg.events === "object" ? lg.events : {},
      stats: lg.stats && typeof lg.stats === "object" ? lg.stats : {},
    };
  }
}

function noteFailure(context: string, message: string, nowS: number): string {
  const full = `${context}: ${message}`;
  failures = recordFailure(failures, full, nowS);
  console.error(`[livelog] ${full}`);
  return full;
}

function buildUrl(api: string, params: Record<string, string | number> | undefined, now: Date, dateValue?: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    let value = String(v);
    if (dateValue !== undefined) value = value.replaceAll("${date}", dateValue);
    qs.set(k, substituteTokens(value, now));
  }
  const query = qs.toString();
  return query ? `${api}?${query}` : api;
}

function sourceKey(source: LiveLogSourceInput): string {
  return `${source.id}|${source.api}|${JSON.stringify(source.params ?? {})}|${JSON.stringify(source.dates ?? [])}`;
}

function statsKey(group: LiveLogStatGroupInput): string {
  return `${group.api}|${JSON.stringify(group.params ?? {})}`;
}

async function fetchSourceEvents(
  source: LiveLogSourceInput,
  cfg: LiveLogConfig,
  now: Date
): Promise<LiveLogEvent[]> {
  const nowS = Math.floor(now.getTime() / 1000);
  // Date fan-out: one request per configured date (tokens expanded first).
  const dates = source.dates?.map(d => substituteTokens(d, now)) ?? [undefined];
  const pages = await Promise.all(
    dates.map(async date => {
      const json = await authedGet(buildUrl(source.api, source.params, now, date), cfg.auth, nowS);
      const rows = resolvePath(json, source.itemsPath);
      if (!Array.isArray(rows)) throw new Error("unexpected response shape");
      return rows;
    })
  );
  return normalizeSourceRows(source, pages.flat(), now, cfg.windowHours);
}

// Re-window cached/last-good events against the current clock so old entries
// age out even while a source is down.
function windowEvents(events: LiveLogEvent[], source: LiveLogSourceInput, cfg: LiveLogConfig, nowS: number): LiveLogEvent[] {
  const cutoff = nowS - (source.windowHours ?? cfg.windowHours) * 3600;
  return events.filter(e => e.time >= cutoff);
}

type SourceOutcome = { events: LiveLogEvent[]; error?: string; stale: boolean };
type StatsOutcome = { stats: LiveLogStat[]; error?: string; stale: boolean };

async function resolveSource(source: LiveLogSourceInput, cfg: LiveLogConfig, now: Date): Promise<SourceOutcome> {
  const nowS = Math.floor(now.getTime() / 1000);
  const key = sourceKey(source);
  const cached = sourceCache.get(key);
  if (cached && now.getTime() - cached.at < SUCCESS_TTL_MS) {
    return { events: windowEvents(cached.value, source, cfg, nowS), stale: false };
  }
  try {
    const events = await fetchSourceEvents(source, cfg, now);
    sourceCache.set(key, { at: now.getTime(), value: events });
    return { events, stale: false };
  } catch (e) {
    const message = noteFailure(source.id, (e as Error).message, nowS);
    const fallback = cached?.value ?? lastGood?.events[key];
    if (fallback) return { events: windowEvents(fallback, source, cfg, nowS), error: message, stale: true };
    return { events: [], error: message, stale: false };
  }
}

async function resolveStats(group: LiveLogStatGroupInput, index: number, cfg: LiveLogConfig, now: Date): Promise<StatsOutcome> {
  const nowS = Math.floor(now.getTime() / 1000);
  const key = statsKey(group);
  const cached = statsCache.get(key);
  if (cached && now.getTime() - cached.at < SUCCESS_TTL_MS) {
    return { stats: cached.value, stale: false };
  }
  const context = `stats[${index}] ${group.items[0]?.label ?? ""}`.trim();
  try {
    const json = await authedGet(buildUrl(group.api, group.params, now), cfg.auth, nowS);
    const stats = extractStats(group, json);
    statsCache.set(key, { at: now.getTime(), value: stats });
    return { stats, stale: false };
  } catch (e) {
    const message = noteFailure(context, (e as Error).message, nowS);
    const fallback = cached?.value ?? lastGood?.stats[key];
    if (fallback) return { stats: fallback, error: message, stale: true };
    // Keep tile layout stable: failed groups render as em-dashes.
    return { stats: group.items.map(item => ({ label: item.label, value: "—" })), error: message, stale: false };
  }
}

function persistLastGood(cfg: LiveLogConfig, sources: SourceOutcome[], stats: StatsOutcome[], now: Date): void {
  loadLastGoodOnce();
  const next: LastGood = { at: now.getTime(), events: { ...lastGood?.events }, stats: { ...lastGood?.stats } };
  let changed = false;
  cfg.sources.forEach((source, i) => {
    if (!sources[i].error && !sources[i].stale) {
      next.events[sourceKey(source)] = sources[i].events;
      changed = true;
    }
  });
  cfg.stats.forEach((group, i) => {
    if (!stats[i].error && !stats[i].stale) {
      next.stats[statsKey(group)] = stats[i].stats;
      changed = true;
    }
  });
  if (changed) {
    lastGood = next;
    writePrivateJson(lastGoodPath(), next);
  }
}

// Test hook: reset all module state (caches, session, failure log).
export function resetLiveLogStateForTests(): void {
  session = null;
  sessionLoaded = false;
  loginInFlight = null;
  sourceCache.clear();
  statsCache.clear();
  failures = [];
  lastGood = null;
  lastGoodLoaded = false;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function getLiveLog(now = new Date()): Promise<LiveLogResult> {
  const cfg = loadConfig().liveLog;
  if (!cfg) {
    return { ok: false, error: 'no live log configured — add a "liveLog" block to config.local.json', hidden: true };
  }
  loadLastGoodOnce();
  const nowS = Math.floor(now.getTime() / 1000);

  // Establish the session once up front so a broken login produces one clear
  // failure instead of one per source.
  if (cfg.auth) {
    try {
      await ensureToken(cfg.auth, nowS);
    } catch (e) {
      const message = noteFailure("login", (e as Error).message, nowS);
      // Serve the last-good snapshot (re-windowed) rather than a blank panel
      // when the API is unreachable but we have yesterday's data on disk.
      const staleEvents = cfg.sources.flatMap(s => {
        const kept = lastGood?.events[sourceKey(s)];
        return kept ? windowEvents(kept, s, cfg, nowS) : [];
      });
      const staleStats = cfg.stats.flatMap(g => lastGood?.stats[statsKey(g)] ?? []);
      if (staleEvents.length === 0 && staleStats.length === 0) {
        return { ok: false, error: message, failures };
      }
      return {
        ok: true,
        title: cfg.title,
        stats: staleStats,
        events: mergeEvents([staleEvents], cfg.maxItems),
        sourceErrors: [{ id: "login", label: "Login", error: message }],
        checkedAt: nowS,
        windowHours: cfg.windowHours,
        stale: true,
        staleReason: message,
        failures,
      };
    }
  }

  const [sourceOutcomes, statsOutcomes] = await Promise.all([
    Promise.all(cfg.sources.map(source => resolveSource(source, cfg, now))),
    Promise.all(cfg.stats.map((group, i) => resolveStats(group, i, cfg, now))),
  ]);

  persistLastGood(cfg, sourceOutcomes, statsOutcomes, now);

  const events = mergeEvents(sourceOutcomes.map(o => o.events), cfg.maxItems);
  const stats = statsOutcomes.flatMap(o => o.stats);
  const sourceErrors: LiveLogSourceError[] = [];
  cfg.sources.forEach((source, i) => {
    const err = sourceOutcomes[i].error;
    if (err) sourceErrors.push({ id: source.id, label: source.label, error: err });
  });
  cfg.stats.forEach((group, i) => {
    const err = statsOutcomes[i].error;
    if (err) sourceErrors.push({ id: `stats-${i}`, label: group.items[0]?.label ?? "stats", error: err });
  });

  const anyFresh =
    sourceOutcomes.some(o => !o.error && !o.stale) || statsOutcomes.some(o => !o.error && !o.stale);
  const anyStale = sourceOutcomes.some(o => o.stale) || statsOutcomes.some(o => o.stale);
  if (!anyFresh && !anyStale && sourceErrors.length > 0 && events.length === 0) {
    return { ok: false, error: sourceErrors[0].error, failures };
  }

  const result: LiveLogResult = {
    ok: true,
    title: cfg.title,
    stats,
    events,
    sourceErrors,
    checkedAt: nowS,
    windowHours: cfg.windowHours,
  };
  if (anyStale) {
    result.stale = true;
    result.staleReason = sourceErrors[0]?.error;
  }
  if (failures.length > 0) result.failures = failures;
  return result;
}
