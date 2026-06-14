import fs from "node:fs";
import path from "node:path";
import type {
  AnalyticsChartInput,
  AnalyticsConfig,
  AnalyticsLocationInput,
  AnalyticsSeriesInput,
  AnalyticsSourceInput,
  AppConfig,
  BirthdayInput,
  LifeConfig,
  ManualEventInput,
  TailscaleHostInput,
} from "./types";

const DEFAULT_REFRESH = 60;
const MIN_REFRESH = 5;
const CONFIG_PATH = path.join(process.cwd(), "config.local.json");

// Treat the example/placeholder values as unset so users who copy
// config.example.json verbatim see the friendly "not configured" message
// instead of a real HTTP error.
function isPlaceholder(url: string): boolean {
  return (
    url.includes("/calendar/ical/.../basic.ics") ||
    url.includes("REPLACE_ME") ||
    url.includes("<paste") ||
    url.trim() === ""
  );
}

// A live source needs a non-empty `api` URL; without it the location falls back
// to static values. `origin`, `params`, and `dateField` are optional.
function parseAnalyticsSource(input: unknown): AnalyticsSourceInput | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.api !== "string" || o.api.trim() === "") return undefined;
  const source: AnalyticsSourceInput = { api: o.api.trim() };
  if (typeof o.origin === "string" && o.origin.trim() !== "") source.origin = o.origin.trim();
  if (typeof o.dateField === "string" && o.dateField.trim() !== "") source.dateField = o.dateField.trim();
  if (o.params && typeof o.params === "object" && !Array.isArray(o.params)) {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number") params[k] = v;
    }
    if (Object.keys(params).length > 0) source.params = params;
  }
  return source;
}

// Validate an `analytics` block defensively, mirroring manualEvents/birthdays:
// drop anything malformed and return null if nothing usable survives, so an
// absent or broken block simply hides the panel rather than erroring.
function parseAnalytics(input: unknown): AnalyticsConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  const locationsRaw = Array.isArray(o.locations) ? o.locations : [];
  const locations: AnalyticsLocationInput[] = locationsRaw.flatMap((l): AnalyticsLocationInput[] => {
    if (!l || typeof l !== "object") return [];
    const lo = l as Record<string, unknown>;
    if (typeof lo.name !== "string" || lo.name.trim() === "") return [];

    const chartsRaw = Array.isArray(lo.charts) ? lo.charts : [];
    const charts: AnalyticsChartInput[] = chartsRaw.flatMap((c): AnalyticsChartInput[] => {
      if (!c || typeof c !== "object") return [];
      const co = c as Record<string, unknown>;
      if (typeof co.title !== "string" || co.title.trim() === "") return [];

      const seriesRaw = Array.isArray(co.series) ? co.series : [];
      const series: AnalyticsSeriesInput[] = seriesRaw.flatMap((s): AnalyticsSeriesInput[] => {
        if (!s || typeof s !== "object") return [];
        const so = s as Record<string, unknown>;
        if (typeof so.label !== "string" || so.label.trim() === "") return [];
        const out: AnalyticsSeriesInput = { label: so.label.trim() };
        // Static mode: literal values (coerced to finite numbers).
        if (Array.isArray(so.values) && so.values.length > 0) {
          out.values = so.values.map(v => {
            const n = typeof v === "number" ? v : Number(v);
            return Number.isFinite(n) ? n : 0;
          });
        }
        // Live mode: name the API field to read per day.
        if (typeof so.field === "string" && so.field.trim() !== "") {
          out.field = so.field.trim();
        }
        // A series needs at least one of the two to render anything.
        if (out.values === undefined && out.field === undefined) return [];
        return [out];
      });

      if (series.length === 0) return [];
      return [{ title: co.title.trim(), series }];
    });

    if (charts.length === 0) return [];
    const out: AnalyticsLocationInput = { name: lo.name.trim(), charts };
    if (typeof lo.url === "string" && lo.url.trim() !== "") out.url = lo.url.trim();
    const source = parseAnalyticsSource(lo.source);
    if (source) out.source = source;
    return [out];
  });

  if (locations.length === 0) return null;

  const days = Array.isArray(o.days)
    ? o.days.filter((d): d is string => typeof d === "string")
    : [];
  const title =
    typeof o.title === "string" && o.title.trim() !== "" ? o.title.trim() : "Analytics";

  return { title, days, locations };
}

export function parseConfig(
  file: Record<string, unknown>,
  env: Record<string, string | undefined>
): AppConfig {
  const raw =
    (env.ICS_URL && String(env.ICS_URL)) ||
    (typeof file.icsUrl === "string" ? file.icsUrl : null);
  const icsUrl = raw && !isPlaceholder(raw) ? raw : null;

  const pinnedEvents = Array.isArray(file.pinnedEvents)
    ? file.pinnedEvents.filter((s): s is string => typeof s === "string")
    : [];

  const manualEvents: ManualEventInput[] = Array.isArray(file.manualEvents)
    ? file.manualEvents.flatMap((e): ManualEventInput[] => {
        if (!e || typeof e !== "object") return [];
        const o = e as Record<string, unknown>;
        if (typeof o.title !== "string" || typeof o.start !== "string") return [];
        const out: ManualEventInput = { title: o.title, start: o.start };
        if (o.pinned === true) out.pinned = true;
        return [out];
      })
    : [];

  const birthdays: BirthdayInput[] = Array.isArray(file.birthdays)
    ? file.birthdays.flatMap((b): BirthdayInput[] => {
        if (!b || typeof b !== "object") return [];
        const o = b as Record<string, unknown>;
        if (typeof o.name !== "string") return [];
        const month = typeof o.month === "number" ? o.month : NaN;
        const day = typeof o.day === "number" ? o.day : NaN;
        if (!Number.isFinite(month) || month < 1 || month > 12) return [];
        if (!Number.isFinite(day) || day < 1 || day > 31) return [];
        const out: BirthdayInput = { name: o.name, month, day };
        if (typeof o.year === "number" && Number.isFinite(o.year)) out.year = o.year;
        return [out];
      })
    : [];

  const refreshRaw =
    typeof file.refreshSeconds === "number" ? file.refreshSeconds : DEFAULT_REFRESH;
  const refreshSeconds = Math.max(MIN_REFRESH, Math.floor(refreshRaw));

  let life: LifeConfig | null = null;
  if (file.life && typeof file.life === "object") {
    const o = file.life as Record<string, unknown>;
    if (
      typeof o.birthDate === "string" &&
      !Number.isNaN(Date.parse(o.birthDate)) &&
      typeof o.expectancyYears === "number" &&
      o.expectancyYears > 0
    ) {
      life = { birthDate: o.birthDate, expectancyYears: o.expectancyYears };
    }
  }

  const tailscaleHosts: TailscaleHostInput[] = Array.isArray(file.tailscaleHosts)
    ? file.tailscaleHosts.flatMap((h): TailscaleHostInput[] => {
        if (!h || typeof h !== "object") return [];
        const o = h as Record<string, unknown>;
        if (typeof o.host !== "string" || o.host.trim() === "") return [];
        const out: TailscaleHostInput = { host: o.host.trim() };
        if (typeof o.alias === "string" && o.alias.trim() !== "") out.alias = o.alias.trim();
        return [out];
      })
    : [];

  const analytics = parseAnalytics(file.analytics);

  return { icsUrl, manualEvents, birthdays, pinnedEvents, refreshSeconds, life, tailscaleHosts, analytics };
}

export function loadConfig(): AppConfig {
  let file: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {
    file = {};
  }
  return parseConfig(file, process.env);
}
