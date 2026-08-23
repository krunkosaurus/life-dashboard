import type { ChecklistConfig } from "./checklists";

export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt?: number;   // unix seconds; omitted when no reset is scheduled
  windowSecs?: number; // window duration in seconds; omitted when unknown
};

// Display-safe details for one banked Codex rate-limit reset. The app-server's
// opaque redemption ID is intentionally not sent to the browser because this
// dashboard only reports reset availability; it never consumes a reset.
export type BankedReset = {
  title?: string;
  description?: string;
  grantedAt?: number; // unix seconds
  expiresAt?: number; // unix seconds; omitted when the reset does not expire
};

export type BankedResetSummary = {
  availableCount: number;
  resets?: BankedReset[]; // omitted when the backend returns only the count
};

// One entry in a usage source's recent-failure log. `at` is unix seconds of
// the most recent occurrence; consecutive identical failures collapse into a
// single entry with a bumped `count`.
export type UsageFailure = {
  message: string;
  at: number;
  count: number;
};

export type UsageResult =
  | { ok: true; windows: UsageWindow[]; bankedResets?: BankedResetSummary; snapshotAt?: number; staleReason?: string; failures?: UsageFailure[] }
  | { ok: false; error: string; failures?: UsageFailure[] };

export type EventItem = {
  title: string;
  start: number;      // unix seconds
  pinned: boolean;
  sinceYear?: number; // origin year (birth/wedding/…); when set, a years-since count is shown
  anniversaryType?: "birthday" | "anniversary"; // set for entries from the `birthdays` config
};

export type EventsResult =
  | { ok: true; events: EventItem[] }
  | { ok: false; error: string };

export type ManualEventInput = {
  title: string;
  start: string;       // ISO 8601 ("2026-06-15T08:00:00Z") or date-only ("2026-09-12")
  pinned?: boolean;
  keepPast?: boolean;  // retain after it passes so the countdown can become negative
};

export type BirthdayInput = {
  name: string;
  month: number;  // 1–12
  day: number;    // 1–31
  year?: number;  // origin year (birth/wedding/…); enables the years-since count
  type?: "birthday" | "anniversary"; // default "birthday"
  label?: string; // optional title override (e.g. "Wedding"); else derived from name + type
};

export type LifeConfig = {
  birthDate: string;       // ISO date ("1990-01-15")
  expectancyYears: number; // e.g. 80
};

export type TailscaleHostInput = {
  host: string;   // bare hostname ("blackpi"), FQDN ("winton.tail87750.ts.net"), or Tailscale IP ("100.126.38.102")
  alias?: string; // display name; falls back to host
};

export type ServerStatus = {
  host: string;
  alias: string;
  online: boolean;
  lastSeen: number | null; // unix seconds the peer was last seen; null when online or never reported
  os?: string;
  found: boolean; // false when the host isn't in the tailnet at all
};

export type ServersResult =
  | { ok: true; servers: ServerStatus[]; checkedAt: number; staleReason?: string }
  | { ok: false; error: string };

export type OuraSleepSummary = {
  day: string;
  score: number | null;
  bedtimeStart: string | null;
  bedtimeEnd: string | null;
  totalSleepSeconds: number | null;
  timeInBedSeconds: number | null;
  efficiency: number | null;
  deepSleepSeconds: number | null;
  remSleepSeconds: number | null;
  lightSleepSeconds: number | null;
  awakeSeconds: number | null;
};

export type OuraActivitySummary = {
  day: string;
  steps: number;
  score: number | null;
  activeCalories: number | null;
  targetCalories: number | null;
  timestamp: string | null;
};

export type OuraResult =
  | {
      ok: true;
      day: string;
      sleep: OuraSleepSummary | null;
      activity: OuraActivitySummary | null;
      activityPending?: boolean;
      checkedAt: number;
      lastSyncedAt: string | null;
      staleReason?: string;
      timeZone: string;
    }
  | {
      ok: false;
      error: string;
      connectUrl?: string;
      hidden?: boolean;
      retryAfterSeconds?: number;
    };

// ---- Analytics: config-file (template) shape, produced by parseConfig ----

// A live data source for a location: a JSON HTTP endpoint returning one row per
// day. Everything is config-driven so no vendor specifics live in code. The
// response may be a top-level array or `{ data: [...] }`; each row is an object
// of `field` → value plus a date field (see `dateField`).
export type AnalyticsSourceInput = {
  api: string;                               // endpoint URL (required)
  origin?: string;                           // sent as Origin/Referer — for APIs that key off it
  params?: Record<string, string | number>; // query params appended to the URL
  rangeParams?: {
    start?: string;                          // query param name for selected range start (default "startDate")
    end?: string;                            // query param name for selected range end (default "endDate")
    offset?: string;                         // query param name for selected week offset (default "weekOffset")
  };
  dateField?: string;                        // row field holding the day (default "date")
};

// A named series. Static mode supplies literal `values`; live mode names the
// API row `field` to read per day. At least one of the two is required.
export type AnalyticsSeriesInput = {
  label: string;
  values?: number[];
  field?: string;
};

export type AnalyticsChartInput = {
  title: string;
  series: AnalyticsSeriesInput[];
};

export type AnalyticsChartLayout = "grid" | "vertical";
export type AnalyticsLocationLayout = "stack" | "grid";

export type AnalyticsLocationInput = {
  name: string;
  url?: string;                  // optional link to the source analytics page
  source?: AnalyticsSourceInput; // present → fetch live; absent → use static values
  chartLayout?: AnalyticsChartLayout; // default "grid"; "vertical" stacks charts
  syncHover?: boolean;           // true → one hovered day highlights all charts in the location
  charts: AnalyticsChartInput[];
};

export type AnalyticsConfig = {
  title: string;                      // panel sub-title; defaults to "Analytics"
  days: string[];                     // static x-axis labels; may be empty (live derives its own)
  locationLayout?: AnalyticsLocationLayout; // default "stack"; "grid" places locations in columns
  locations: AnalyticsLocationInput[];
};

// ---- Analytics: resolved (client-facing) shape, produced by getAnalytics ----

// One numeric value per day in the enclosing AnalyticsResolved.days.
export type AnalyticsSeries = {
  label: string;
  values: number[];
};

export type AnalyticsChart = {
  title: string;
  series: AnalyticsSeries[];
};

export type AnalyticsLocation = {
  name: string;
  url?: string;
  chartLayout?: AnalyticsChartLayout;
  syncHover?: boolean;
  charts: AnalyticsChart[];
  error?: string; // set when a live fetch failed; charts is then empty
};

export type AnalyticsResolved = {
  title: string;
  days: string[];      // x-axis labels (e.g. ["Jun 8 - Mon", …])
  locationLayout?: AnalyticsLocationLayout;
  locations: AnalyticsLocation[];
};

export type AnalyticsResult =
  | { ok: true; analytics: AnalyticsResolved }
  | { ok: false; error: string };

// ---- Live log: config-file (template) shape, produced by parseConfig ----

// Derive a secp256k1 signing key from username+password credentials via
// PBKDF2-SHA256 (the common web3 "credentials wallet" pattern). Only the env
// var NAMES live in config; the values stay in .env.local.
export type LiveLogDeriveInput = {
  usernameEnv: string;
  passwordEnv: string;
  salt: string;
  iterations?: number;          // default 10000
  lowercaseUsername?: boolean;  // default true
};

// EIP-712 typed-data signing of the login nonce. `types` describes one flat
// struct (field types: address | string | uint256); `message` values are
// templates that may use ${nonce} and ${walletAddress}.
export type LiveLogEip712Input = {
  scheme: "eip712";
  domain: { name?: string; version?: string; chainId?: string | number; verifyingContract?: string };
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
  message: Record<string, string>;
};

export type LiveLogSignatureInput = { scheme: "personal" } | LiveLogEip712Input;

// Wallet-signature login: fetch a nonce, sign it (EIP-191 personal_sign by
// default, or EIP-712 via `signature`), POST the signature to `loginUrl`, and
// read a bearer token out of the response at `tokenPath`. The key comes from
// `privateKeyEnv` or is derived from credentials via `derive`. Everything is
// config-driven so no vendor specifics live in code.
export type LiveLogAuthInput = {
  type: "walletSign";
  nonceUrl: string;
  loginUrl: string;
  walletAddress?: string;                   // optional; derived from the key when absent
  privateKeyEnv?: string;                   // env var NAME holding the hex signing key
  derive?: LiveLogDeriveInput;              // alternative to privateKeyEnv
  signature?: LiveLogSignatureInput;        // default { scheme: "personal" }
  origin?: string;                          // sent as Origin/Referer — for APIs that key off it
  extraBody?: Record<string, string | number | boolean>; // merged into the login body
  noncePath?: string;                       // response path to the nonce (default "data.nonce")
  tokenPath?: string;                       // response path to the token (default "data.token")
};

export type LiveLogStatFormat = "number" | "usd" | "percent";

export type LiveLogStatItemInput = {
  label: string;
  path: string;                // dotted response path, e.g. "data.total.count" or "data.byTerm[term=monthly].count"
  format?: LiveLogStatFormat;  // default "number"
};

// One endpoint that yields one or more stat tiles.
export type LiveLogStatGroupInput = {
  api: string;
  params?: Record<string, string | number>; // values may use ${...} tokens
  items: LiveLogStatItemInput[];
};

// A chip rendered on a feed row. With `map`, the field's value is translated
// (and unmapped values render no chip); without it the raw value is shown.
export type LiveLogBadgeInput = {
  field: string;
  map?: Record<string, string>;
  color?: string;
};

// One test against a row field. `equals`/`in` compare stringified values;
// `nonNull` asserts presence (or absence, when false). Multiple keys on one
// condition must all hold.
export type LiveLogCondition = {
  field: string;
  equals?: string | number | boolean;
  in?: (string | number | boolean)[];
  nonNull?: boolean;
};

// Reclassify a row when its conditions match: first matching variant overrides
// the row's label/color. `when` is a single condition or an array that must ALL
// match (e.g. status in [active,grace] AND trialEnd present → "Converted").
export type LiveLogVariantInput = {
  when: LiveLogCondition | LiveLogCondition[];
  label?: string;
  color?: string;
};

// Collapse retry-like rows from one source while preserving the newest row in
// each cluster. Every `by` field must be present; `when` limits the rule to a
// particular kind of row so unrelated lifecycle events stay distinct.
export type LiveLogCollapseInput = {
  by: string[];
  withinMinutes: number;
  when?: LiveLogCondition | LiveLogCondition[];
};

// Resolve extra fields per row from a second endpoint (e.g. an id → profile
// lookup), merged into the row before templating. Results are cached per key
// for `ttlHours` and capped at `max` lookups per refresh, so the feed stays
// cheap. Lookup failures leave the fields absent rather than dropping the row.
export type LiveLogEnrichInput = {
  api: string;                     // may contain ${value} — the key field's value
  key: string;                     // row field supplying the lookup value
  fields: Record<string, string>;  // row field name → response path
  ttlHours?: number;               // default 24
  max?: number;                    // default 25
};

export type LiveLogSourceInput = {
  id: string;
  label: string;            // row label ("Signup"); variants may override
  color?: string;           // row dot/label tint
  api: string;
  params?: Record<string, string | number>; // values may use ${...} tokens
  dates?: string[];         // fan-out: one request per entry, substituting ${date}
  itemsPath: string;        // response path to the row array
  time: string;             // row field holding the timestamp (s / ms / ISO auto-detected)
  title?: string;           // "{field}" templates; missing fields collapse cleanly
  detail?: string;
  value?: string;           // right-aligned text (e.g. "${amountInDollars} · {amountInTokens}⚡")
  badges?: LiveLogBadgeInput[];
  variants?: LiveLogVariantInput[];
  collapse?: LiveLogCollapseInput[];
  // Row gates applied before anything renders. `require` keeps only rows where
  // every condition holds; `exclude` drops rows matching any condition. These
  // are the local backstop for server-side query filters — if an API ignores a
  // status param, unwanted rows still never reach the feed.
  require?: LiveLogCondition[];
  exclude?: LiveLogCondition[];
  enrich?: LiveLogEnrichInput;
  windowHours?: number;     // override the feed-wide window for this source
  limit?: number;           // per-source row cap after sorting (default 50)
};

export type LiveLogConfig = {
  title: string;            // panel title; defaults to "Live Log"
  windowHours: number;      // feed window (default 48)
  maxItems: number;         // merged feed cap (default 60)
  auth: LiveLogAuthInput | null;
  stats: LiveLogStatGroupInput[];
  sources: LiveLogSourceInput[];
};

// ---- Live log: resolved (client-facing) shape, produced by getLiveLog ----

export type LiveLogStat = {
  label: string;
  value: string;            // pre-formatted server-side ("1,204", "$318.40", "18.2%", "—")
};

export type LiveLogBadge = { text: string; color?: string };

export type LiveLogEvent = {
  id: string;               // unique per row (sourceId + time + title + index)
  sourceId: string;
  label: string;
  color: string;
  time: number;             // unix seconds
  title: string;
  detail?: string;
  value?: string;
  badges: LiveLogBadge[];
};

export type LiveLogSourceError = { id: string; label: string; error: string };

export type LiveLogResult =
  | {
      ok: true;
      title: string;
      stats: LiveLogStat[];
      events: LiveLogEvent[];
      sourceErrors: LiveLogSourceError[];
      checkedAt: number;    // unix seconds
      windowHours: number;
      stale?: boolean;      // true when any part was served from the last-good snapshot
      staleReason?: string;
      failures?: UsageFailure[];
    }
  | { ok: false; error: string; hidden?: boolean; failures?: UsageFailure[] };

export type AppConfig = {
  icsUrl: string | null;
  manualEvents: ManualEventInput[];
  birthdays: BirthdayInput[];
  pinnedEvents: string[];
  refreshSeconds: number;
  life: LifeConfig | null;
  tailscaleHosts: TailscaleHostInput[];
  analytics: AnalyticsConfig | null; // parsed template; resolved by getAnalytics
  checklists: ChecklistConfig | null; // parsed template; resolved by resolveChecklist
  liveLog: LiveLogConfig | null;      // parsed template; resolved by getLiveLog
};
