import fs from "node:fs";
import path from "node:path";
import { parseChecklists } from "./checklists";
import type {
  AnalyticsChartInput,
  AnalyticsChartLayout,
  AnalyticsConfig,
  AnalyticsLocationLayout,
  AnalyticsLocationInput,
  AnalyticsSeriesInput,
  AnalyticsSourceInput,
  AppConfig,
  BirthdayInput,
  LifeConfig,
  LiveLogAuthInput,
  LiveLogBadgeInput,
  LiveLogCondition,
  LiveLogConfig,
  LiveLogDeriveInput,
  LiveLogEip712Input,
  LiveLogEnrichInput,
  LiveLogSignatureInput,
  LiveLogSourceInput,
  LiveLogStatFormat,
  LiveLogStatGroupInput,
  LiveLogVariantInput,
  ManualEventInput,
  TailscaleHostInput,
} from "./types";

const DEFAULT_REFRESH = 60;
const MIN_REFRESH = 5;
const CONFIG_PATH = path.join(process.cwd(), "config.local.json");
const ANALYTICS_CHART_LAYOUTS = new Set<AnalyticsChartLayout>(["grid", "vertical"]);
const ANALYTICS_LOCATION_LAYOUTS = new Set<AnalyticsLocationLayout>(["stack", "grid"]);

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
  if (o.rangeParams && typeof o.rangeParams === "object" && !Array.isArray(o.rangeParams)) {
    const raw = o.rangeParams as Record<string, unknown>;
    const rangeParams: NonNullable<AnalyticsSourceInput["rangeParams"]> = {};
    if (typeof raw.start === "string" && raw.start.trim() !== "") rangeParams.start = raw.start.trim();
    if (typeof raw.end === "string" && raw.end.trim() !== "") rangeParams.end = raw.end.trim();
    if (typeof raw.offset === "string" && raw.offset.trim() !== "") rangeParams.offset = raw.offset.trim();
    if (Object.keys(rangeParams).length > 0) source.rangeParams = rangeParams;
  }
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
    if (typeof lo.chartLayout === "string" && ANALYTICS_CHART_LAYOUTS.has(lo.chartLayout as AnalyticsChartLayout)) {
      out.chartLayout = lo.chartLayout as AnalyticsChartLayout;
    }
    if (typeof lo.syncHover === "boolean") out.syncHover = lo.syncHover;
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
  const locationLayout =
    typeof o.locationLayout === "string" && ANALYTICS_LOCATION_LAYOUTS.has(o.locationLayout as AnalyticsLocationLayout)
      ? (o.locationLayout as AnalyticsLocationLayout)
      : undefined;

  return { title, days, ...(locationLayout ? { locationLayout } : {}), locations };
}

const LIVELOG_STAT_FORMATS = new Set<LiveLogStatFormat>(["number", "usd", "percent"]);
const LIVELOG_DEFAULT_WINDOW_HOURS = 48;
const LIVELOG_DEFAULT_MAX_ITEMS = 60;

function parseStringRecord(input: unknown): Record<string, string | number> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseLiveLogDerive(input: unknown): LiveLogDeriveInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  for (const key of ["usernameEnv", "passwordEnv", "salt"]) {
    if (typeof o[key] !== "string" || (o[key] as string).trim() === "") return null;
  }
  const derive: LiveLogDeriveInput = {
    usernameEnv: (o.usernameEnv as string).trim(),
    passwordEnv: (o.passwordEnv as string).trim(),
    salt: o.salt as string,
  };
  if (typeof o.iterations === "number" && Number.isFinite(o.iterations) && o.iterations > 0) {
    derive.iterations = Math.floor(o.iterations);
  }
  if (typeof o.lowercaseUsername === "boolean") derive.lowercaseUsername = o.lowercaseUsername;
  return derive;
}

function parseLiveLogSignature(input: unknown): LiveLogSignatureInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (o.scheme === "personal") return { scheme: "personal" };
  if (o.scheme !== "eip712") return null;
  if (!o.domain || typeof o.domain !== "object" || Array.isArray(o.domain)) return null;
  if (typeof o.primaryType !== "string" || o.primaryType.trim() === "") return null;
  if (!o.types || typeof o.types !== "object" || Array.isArray(o.types)) return null;
  if (!o.message || typeof o.message !== "object" || Array.isArray(o.message)) return null;
  const domainRaw = o.domain as Record<string, unknown>;
  const domain: LiveLogEip712Input["domain"] = {};
  if (typeof domainRaw.name === "string") domain.name = domainRaw.name;
  if (typeof domainRaw.version === "string") domain.version = domainRaw.version;
  if (typeof domainRaw.chainId === "string" || typeof domainRaw.chainId === "number") domain.chainId = domainRaw.chainId;
  if (typeof domainRaw.verifyingContract === "string") domain.verifyingContract = domainRaw.verifyingContract;
  const types: LiveLogEip712Input["types"] = {};
  for (const [name, fields] of Object.entries(o.types as Record<string, unknown>)) {
    if (!Array.isArray(fields)) continue;
    const parsed = fields.flatMap(f => {
      if (!f || typeof f !== "object") return [];
      const fo = f as Record<string, unknown>;
      if (typeof fo.name !== "string" || typeof fo.type !== "string") return [];
      return [{ name: fo.name, type: fo.type }];
    });
    if (parsed.length > 0) types[name] = parsed;
  }
  const message: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.message as Record<string, unknown>)) {
    if (typeof v === "string") message[k] = v;
  }
  if (!types[o.primaryType.trim()] || Object.keys(message).length === 0) return null;
  return { scheme: "eip712", domain, primaryType: o.primaryType.trim(), types, message };
}

function parseLiveLogAuth(input: unknown): LiveLogAuthInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (o.type !== "walletSign") return null;
  for (const key of ["nonceUrl", "loginUrl"]) {
    if (typeof o[key] !== "string" || (o[key] as string).trim() === "") return null;
  }
  const privateKeyEnv =
    typeof o.privateKeyEnv === "string" && o.privateKeyEnv.trim() !== "" ? o.privateKeyEnv.trim() : undefined;
  const derive = parseLiveLogDerive(o.derive);
  // A usable auth block needs some way to obtain the signing key.
  if (!privateKeyEnv && !derive) return null;
  const auth: LiveLogAuthInput = {
    type: "walletSign",
    nonceUrl: (o.nonceUrl as string).trim(),
    loginUrl: (o.loginUrl as string).trim(),
  };
  if (privateKeyEnv) auth.privateKeyEnv = privateKeyEnv;
  else if (derive) auth.derive = derive;
  if (typeof o.walletAddress === "string" && o.walletAddress.trim() !== "") {
    auth.walletAddress = o.walletAddress.trim();
  }
  const signature = parseLiveLogSignature(o.signature);
  if (signature) auth.signature = signature;
  if (typeof o.origin === "string" && o.origin.trim() !== "") auth.origin = o.origin.trim();
  if (typeof o.noncePath === "string" && o.noncePath.trim() !== "") auth.noncePath = o.noncePath.trim();
  if (typeof o.tokenPath === "string" && o.tokenPath.trim() !== "") auth.tokenPath = o.tokenPath.trim();
  if (o.extraBody && typeof o.extraBody === "object" && !Array.isArray(o.extraBody)) {
    const extra: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(o.extraBody as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") extra[k] = v;
    }
    if (Object.keys(extra).length > 0) auth.extraBody = extra;
  }
  return auth;
}

function parseLiveLogStats(input: unknown): LiveLogStatGroupInput[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((g): LiveLogStatGroupInput[] => {
    if (!g || typeof g !== "object") return [];
    const o = g as Record<string, unknown>;
    if (typeof o.api !== "string" || o.api.trim() === "") return [];
    const itemsRaw = Array.isArray(o.items) ? o.items : [];
    const items = itemsRaw.flatMap((it): LiveLogStatGroupInput["items"] => {
      if (!it || typeof it !== "object") return [];
      const io = it as Record<string, unknown>;
      if (typeof io.label !== "string" || io.label.trim() === "") return [];
      if (typeof io.path !== "string" || io.path.trim() === "") return [];
      const item: LiveLogStatGroupInput["items"][number] = {
        label: io.label.trim(),
        path: io.path.trim(),
      };
      if (typeof io.format === "string" && LIVELOG_STAT_FORMATS.has(io.format as LiveLogStatFormat)) {
        item.format = io.format as LiveLogStatFormat;
      }
      return [item];
    });
    if (items.length === 0) return [];
    const group: LiveLogStatGroupInput = { api: o.api.trim(), items };
    const params = parseStringRecord(o.params);
    if (params) group.params = params;
    return [group];
  });
}

// Accept a single condition or an array; drop any that test nothing.
function parseLiveLogConditions(input: unknown): LiveLogCondition[] {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  return list.flatMap((c): LiveLogCondition[] => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return [];
    const o = c as Record<string, unknown>;
    if (typeof o.field !== "string" || o.field.trim() === "") return [];
    const cond: LiveLogCondition = { field: o.field.trim() };
    if (typeof o.equals === "string" || typeof o.equals === "number" || typeof o.equals === "boolean") {
      cond.equals = o.equals;
    }
    if (Array.isArray(o.in)) {
      const values = o.in.filter(
        (v): v is string | number | boolean =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      );
      if (values.length > 0) cond.in = values;
    }
    if (typeof o.nonNull === "boolean") cond.nonNull = o.nonNull;
    if (cond.equals === undefined && cond.in === undefined && cond.nonNull === undefined) return [];
    return [cond];
  });
}

function parseLiveLogEnrich(input: unknown): LiveLogEnrichInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.api !== "string" || o.api.trim() === "") return null;
  if (typeof o.key !== "string" || o.key.trim() === "") return null;
  if (!o.fields || typeof o.fields !== "object" || Array.isArray(o.fields)) return null;
  const fields: Record<string, string> = {};
  for (const [name, path] of Object.entries(o.fields as Record<string, unknown>)) {
    if (typeof path === "string" && path.trim() !== "") fields[name] = path.trim();
  }
  if (Object.keys(fields).length === 0) return null;
  const enrich: LiveLogEnrichInput = { api: o.api.trim(), key: o.key.trim(), fields };
  if (typeof o.ttlHours === "number" && Number.isFinite(o.ttlHours) && o.ttlHours > 0) enrich.ttlHours = o.ttlHours;
  if (typeof o.max === "number" && Number.isFinite(o.max) && o.max > 0) enrich.max = Math.floor(o.max);
  return enrich;
}

function parseLiveLogSources(input: unknown): LiveLogSourceInput[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((s): LiveLogSourceInput[] => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    for (const key of ["id", "label", "api", "itemsPath", "time"]) {
      if (typeof o[key] !== "string" || (o[key] as string).trim() === "") return [];
    }
    const source: LiveLogSourceInput = {
      id: (o.id as string).trim(),
      label: (o.label as string).trim(),
      api: (o.api as string).trim(),
      itemsPath: (o.itemsPath as string).trim(),
      time: (o.time as string).trim(),
    };
    if (typeof o.color === "string" && o.color.trim() !== "") source.color = o.color.trim();
    for (const key of ["title", "detail", "value"] as const) {
      if (typeof o[key] === "string" && (o[key] as string).trim() !== "") source[key] = (o[key] as string).trim();
    }
    const params = parseStringRecord(o.params);
    if (params) source.params = params;
    if (Array.isArray(o.dates)) {
      const dates = o.dates.filter((d): d is string => typeof d === "string" && d.trim() !== "");
      if (dates.length > 0) source.dates = dates;
    }
    if (Array.isArray(o.badges)) {
      const badges = o.badges.flatMap((b): LiveLogBadgeInput[] => {
        if (!b || typeof b !== "object") return [];
        const bo = b as Record<string, unknown>;
        if (typeof bo.field !== "string" || bo.field.trim() === "") return [];
        const badge: LiveLogBadgeInput = { field: bo.field.trim() };
        if (typeof bo.color === "string" && bo.color.trim() !== "") badge.color = bo.color.trim();
        if (bo.map && typeof bo.map === "object" && !Array.isArray(bo.map)) {
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(bo.map as Record<string, unknown>)) {
            if (typeof v === "string") map[k] = v;
          }
          if (Object.keys(map).length > 0) badge.map = map;
        }
        return [badge];
      });
      if (badges.length > 0) source.badges = badges;
    }
    if (Array.isArray(o.variants)) {
      const variants = o.variants.flatMap((v): LiveLogVariantInput[] => {
        if (!v || typeof v !== "object") return [];
        const vo = v as Record<string, unknown>;
        const conditions = parseLiveLogConditions(vo.when);
        if (conditions.length === 0) return [];
        const variant: LiveLogVariantInput = { when: conditions };
        if (typeof vo.label === "string" && vo.label.trim() !== "") variant.label = vo.label.trim();
        if (typeof vo.color === "string" && vo.color.trim() !== "") variant.color = vo.color.trim();
        if (variant.label === undefined && variant.color === undefined) return [];
        return [variant];
      });
      if (variants.length > 0) source.variants = variants;
    }
    const require = parseLiveLogConditions(o.require);
    if (require.length > 0) source.require = require;
    const exclude = parseLiveLogConditions(o.exclude);
    if (exclude.length > 0) source.exclude = exclude;
    const enrich = parseLiveLogEnrich(o.enrich);
    if (enrich) source.enrich = enrich;
    if (typeof o.windowHours === "number" && Number.isFinite(o.windowHours) && o.windowHours > 0) {
      source.windowHours = o.windowHours;
    }
    if (typeof o.limit === "number" && Number.isFinite(o.limit) && o.limit > 0) {
      source.limit = Math.floor(o.limit);
    }
    return [source];
  });
}

// Validate a `liveLog` block defensively, mirroring analytics: drop anything
// malformed and return null when nothing usable survives, so an absent or
// broken block simply hides the panel rather than erroring.
function parseLiveLog(input: unknown): LiveLogConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const stats = parseLiveLogStats(o.stats);
  const sources = parseLiveLogSources(o.sources);
  if (stats.length === 0 && sources.length === 0) return null;
  const title = typeof o.title === "string" && o.title.trim() !== "" ? o.title.trim() : "Live Log";
  const windowHours =
    typeof o.windowHours === "number" && Number.isFinite(o.windowHours) && o.windowHours > 0
      ? o.windowHours
      : LIVELOG_DEFAULT_WINDOW_HOURS;
  const maxItems =
    typeof o.maxItems === "number" && Number.isFinite(o.maxItems) && o.maxItems > 0
      ? Math.floor(o.maxItems)
      : LIVELOG_DEFAULT_MAX_ITEMS;
  return { title, windowHours, maxItems, auth: parseLiveLogAuth(o.auth), stats, sources };
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
        if (o.keepPast === true) out.keepPast = true;
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
        if (o.type === "anniversary" || o.type === "birthday") out.type = o.type;
        if (typeof o.label === "string") out.label = o.label;
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
  const checklists = parseChecklists(file.checklists);
  const liveLog = parseLiveLog(file.liveLog);

  return { icsUrl, manualEvents, birthdays, pinnedEvents, refreshSeconds, life, tailscaleHosts, analytics, checklists, liveLog };
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
