import { loadConfig } from "./config";
import type {
  AnalyticsChart,
  AnalyticsChartInput,
  AnalyticsLocation,
  AnalyticsLocationInput,
  AnalyticsResolved,
  AnalyticsResult,
  AnalyticsSourceInput,
} from "./types";

const FETCH_TIMEOUT_MS = 10_000;
// Daily data changes slowly; cache successful resolutions briefly so the
// dashboard's polling doesn't refetch on every tick. Per-location errors are
// not cached, so a failed location retries on the next poll (the user asked for
// errors to surface immediately rather than serving stale data).
const SUCCESS_TTL_MS = 60_000;
const DAY_MS = 86_400_000;
let cache = new Map<string, { at: number; result: AnalyticsResult }>();

type HistoricalRow = Record<string, unknown>;
type AnalyticsOptions = { weekOffset?: number; now?: Date };
type AnalyticsDateRange = { startDate: string; endDate: string; weekOffset: number };

function ymdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeWeekOffset(offset: unknown): number {
  const n = typeof offset === "number" ? offset : Number(offset);
  return Number.isFinite(n) ? Math.min(0, Math.trunc(n)) : 0;
}

export function analyticsRangeForWeekOffset(weekOffset: number, now = new Date()): AnalyticsDateRange {
  const offset = normalizeWeekOffset(weekOffset);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset * 7));
  const start = new Date(end.getTime() - 6 * DAY_MS);
  return { startDate: ymdUtc(start), endDate: ymdUtc(end), weekOffset: offset };
}

export function requestedDaysForWeekOffset(weekOffset: number): number {
  return (Math.abs(normalizeWeekOffset(weekOffset)) + 1) * 7;
}

export function rowsForWeekOffset<T>(rows: T[], weekOffset: number): T[] {
  const weeksBack = Math.abs(normalizeWeekOffset(weekOffset));
  const end = rows.length - weeksBack * 7;
  if (end <= 0) return [];
  return rows.slice(Math.max(0, end - 7), end);
}

// Format an ISO date ("2026-06-08") as a short UTC label ("Jun 8 - Mon").
// The dates are calendar days, so format in UTC to avoid a local-timezone
// off-by-one.
export function formatDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const date = new Date(t);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} - ${weekday}`;
}

// Pure mapping: turn historical API rows + a location's chart templates into
// resolved charts. Each series reads its `field` from every row (live mode), or
// passes through its static `values`. Day labels come from each row's
// `dateField` (default "date").
export function resolveCharts(
  charts: AnalyticsChartInput[],
  rows: HistoricalRow[],
  dateField = "date"
): { days: string[]; charts: AnalyticsChart[] } {
  const days = rows.map(r => formatDay(typeof r[dateField] === "string" ? (r[dateField] as string) : ""));
  const resolved: AnalyticsChart[] = charts.map(c => ({
    title: c.title,
    series: c.series.map(s => ({
      label: s.label,
      values: s.field
        ? rows.map(r => {
            const n = Number(r[s.field as string]);
            return Number.isFinite(n) ? n : 0;
          })
        : (s.values ?? []),
    })),
  }));
  return { days, charts: resolved };
}

async function fetchHistorical(source: AnalyticsSourceInput, range: AnalyticsDateRange): Promise<HistoricalRow[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(source.params ?? {})) qs.set(k, String(v));
  const configuredDays = Number(qs.get("days"));
  const requestedDays = source.rangeParams
    ? 7
    : Math.max(Number.isFinite(configuredDays) ? configuredDays : 0, requestedDaysForWeekOffset(range.weekOffset));
  qs.set("days", String(requestedDays));
  if (source.rangeParams) {
    const rangeParams = {
      start: source.rangeParams.start ?? "startDate",
      end: source.rangeParams.end ?? "endDate",
      offset: source.rangeParams.offset ?? "weekOffset",
    };
    qs.set(rangeParams.start, range.startDate);
    qs.set(rangeParams.end, range.endDate);
    qs.set(rangeParams.offset, String(range.weekOffset));
  }
  const url = qs.toString() ? `${source.api}?${qs.toString()}` : source.api;

  // Some APIs segregate data by the request's Origin header; send it (and a
  // matching Referer) when configured. Node's fetch permits setting Origin.
  const headers: Record<string, string> = {};
  if (source.origin) {
    headers.Origin = source.origin;
    headers.Referer = `${source.origin}/`;
  }

  const res = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!rows) throw new Error("unexpected response shape");
  return source.rangeParams ? rows as HistoricalRow[] : rowsForWeekOffset(rows as HistoricalRow[], range.weekOffset);
}

async function resolveLocation(
  loc: AnalyticsLocationInput,
  range: AnalyticsDateRange
): Promise<{ days: string[]; location: AnalyticsLocation }> {
  const base: AnalyticsLocation = { name: loc.name, charts: [] };
  if (loc.url) base.url = loc.url;
  if (loc.chartLayout) base.chartLayout = loc.chartLayout;
  if (typeof loc.syncHover === "boolean") base.syncHover = loc.syncHover;

  // Static location: no source, use the literal values as-is.
  if (!loc.source) {
    const { charts } = resolveCharts(loc.charts, []);
    return { days: [], location: { ...base, charts } };
  }

  // Live location: fetch and map; on failure surface a per-location error.
  try {
    const rows = await fetchHistorical(loc.source, range);
    const { days, charts } = resolveCharts(loc.charts, rows, loc.source.dateField);
    return { days, location: { ...base, charts } };
  } catch (e) {
    return { days: [], location: { ...base, error: (e as Error).message } };
  }
}

export async function getAnalytics(options: AnalyticsOptions = {}): Promise<AnalyticsResult> {
  const range = analyticsRangeForWeekOffset(options.weekOffset ?? 0, options.now);
  const cacheKey = `${range.startDate}:${range.endDate}:${range.weekOffset}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUCCESS_TTL_MS) return cached.result;

  const template = loadConfig().analytics;
  if (!template || template.locations.length === 0) {
    return { ok: false, error: 'no analytics configured — add an "analytics" block to config.local.json' };
  }

  const resolved = await Promise.all(template.locations.map((loc) => resolveLocation(loc, range)));
  // Day labels come from the first location that fetched live; otherwise fall
  // back to the template's static labels.
  const days = resolved.find(r => r.days.length > 0)?.days ?? template.days;
  const analytics: AnalyticsResolved = {
    title: template.title,
    days,
    ...(template.locationLayout ? { locationLayout: template.locationLayout } : {}),
    locations: resolved.map(r => r.location),
  };

  const result: AnalyticsResult = { ok: true, analytics };
  // Only cache a fully-healthy result so failed locations retry next poll.
  if (!resolved.some(r => r.location.error)) cache.set(cacheKey, { at: Date.now(), result });
  return result;
}
