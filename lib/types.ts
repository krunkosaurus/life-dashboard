import type { ChecklistConfig } from "./checklists";

export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt: number;    // unix seconds
  windowSecs?: number; // window duration in seconds; omitted when unknown
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
  | { ok: true; windows: UsageWindow[]; snapshotAt?: number; staleReason?: string; failures?: UsageFailure[] }
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
  | { ok: true; servers: ServerStatus[]; checkedAt: number }
  | { ok: false; error: string };

// ---- Analytics: config-file (template) shape, produced by parseConfig ----

// A live data source for a location: a JSON HTTP endpoint returning one row per
// day. Everything is config-driven so no vendor specifics live in code. The
// response may be a top-level array or `{ data: [...] }`; each row is an object
// of `field` → value plus a date field (see `dateField`).
export type AnalyticsSourceInput = {
  api: string;                               // endpoint URL (required)
  origin?: string;                           // sent as Origin/Referer — for APIs that key off it
  params?: Record<string, string | number>; // query params appended to the URL
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

export type AnalyticsLocationInput = {
  name: string;
  url?: string;                  // optional link to the source analytics page
  source?: AnalyticsSourceInput; // present → fetch live; absent → use static values
  charts: AnalyticsChartInput[];
};

export type AnalyticsConfig = {
  title: string;                      // panel sub-title; defaults to "Analytics"
  days: string[];                     // static x-axis labels; may be empty (live derives its own)
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
  charts: AnalyticsChart[];
  error?: string; // set when a live fetch failed; charts is then empty
};

export type AnalyticsResolved = {
  title: string;
  days: string[];      // x-axis labels (e.g. ["Jun 8", …])
  locations: AnalyticsLocation[];
};

export type AnalyticsResult =
  | { ok: true; analytics: AnalyticsResolved }
  | { ok: false; error: string };

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
};
