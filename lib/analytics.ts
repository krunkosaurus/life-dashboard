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
let cache: { at: number; result: AnalyticsResult } | null = null;

type HistoricalRow = Record<string, unknown>;

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

async function fetchHistorical(source: AnalyticsSourceInput): Promise<HistoricalRow[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(source.params ?? {})) qs.set(k, String(v));
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
  return rows as HistoricalRow[];
}

async function resolveLocation(
  loc: AnalyticsLocationInput
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
    const rows = await fetchHistorical(loc.source);
    const { days, charts } = resolveCharts(loc.charts, rows, loc.source.dateField);
    return { days, location: { ...base, charts } };
  } catch (e) {
    return { days: [], location: { ...base, error: (e as Error).message } };
  }
}

export async function getAnalytics(): Promise<AnalyticsResult> {
  if (cache && Date.now() - cache.at < SUCCESS_TTL_MS) return cache.result;

  const template = loadConfig().analytics;
  if (!template || template.locations.length === 0) {
    return { ok: false, error: 'no analytics configured — add an "analytics" block to config.local.json' };
  }

  const resolved = await Promise.all(template.locations.map(resolveLocation));
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
  if (!resolved.some(r => r.location.error)) cache = { at: Date.now(), result };
  return result;
}
