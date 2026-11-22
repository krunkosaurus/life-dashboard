import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config";
import { celsiusToFahrenheit, groupClimateLocations } from "./climateTypes";
import type { ClimateConfig, ClimatePoint, ClimateResult, ClimateSensor } from "./climateTypes";

const SENSIBO_API = "https://home.sensibo.com/api/v2";
const SNAPSHOT_TTL_MS = 60_000;
const HISTORY_TTL_MS = 5 * 60_000;

type HubCard = {
  id: string; kind: string; label: string; place: string; area: string;
  latest: { ts: number; temperature_c: number | null; humidity_pct: number | null; co2_ppm: number | null } | null;
  battery_pct: number | null;
  last_error: string | null;
  last_error_ts: number | null;
  last_ok_ts: number | null;
  log_error: string | null;
  trend: [number, number | null][];
};

type SensiboPod = {
  id: string;
  room: { name: string };
  location: { name: string };
  measurements: { time?: { time: string }; temperature: number | null; humidity: number | null };
  connectionStatus: { isAlive: boolean };
  acState: { on: boolean; mode: string; targetTemperature?: number; temperatureUnit?: string; fanLevel: string };
  smartMode?: {
    enabled: boolean;
    lowTemperatureThreshold?: number | null; highTemperatureThreshold?: number | null;
    lowTemperatureState?: { on: boolean } | null; highTemperatureState?: { on: boolean } | null;
  } | null;
};

// Sensibo stores Climate React thresholds in Celsius regardless of the AC's unit.
function climateReact(rule: SensiboPod["smartMode"]): NonNullable<ClimateSensor["ac"]>["climateReact"] {
  if (!rule?.enabled || rule.highTemperatureThreshold == null || rule.lowTemperatureThreshold == null) return null;
  return {
    aboveF: Math.round(celsiusToFahrenheit(rule.highTemperatureThreshold)!), aboveOn: rule.highTemperatureState?.on ?? true,
    belowF: Math.round(celsiusToFahrenheit(rule.lowTemperatureThreshold)!), belowOn: rule.lowTemperatureState?.on ?? false,
  };
}

export function aranetSensors(cards: HubCard[], labels: Record<string, string>): ClimateSensor[] {
  return cards.filter(card => card.kind === "aranet4").map(card => ({
    id: card.id,
    kind: "aranet4",
    label: card.label,
    area: labels[card.id] ?? card.area,
    location: card.place,
    measuredAt: card.latest?.ts ?? null,
    temperatureF: celsiusToFahrenheit(card.latest?.temperature_c ?? null),
    humidity: card.latest?.humidity_pct ?? null,
    co2: card.latest?.co2_ppm ?? null,
    battery: card.battery_pct,
    online: true,
    error: card.last_error_ts != null && (card.last_ok_ts == null || card.last_error_ts > card.last_ok_ts)
      ? "The latest sensor collection failed." : null,
    historyError: card.log_error ? "The monitor's history download is failing." : null,
    history: card.trend.flatMap(([ts, value]) => value == null ? [] : [{ ts, temperatureF: celsiusToFahrenheit(value)! }]),
    ac: null,
  }));
}

export function sensiboSensor(pod: SensiboPod, labels: Record<string, string>): ClimateSensor {
  const id = `sensibo-${pod.id.toLowerCase()}`;
  const target = pod.acState.targetTemperature;
  return {
    id, kind: "sensibo", label: "Sensibo Sky",
    area: labels[id] ?? pod.room.name.charAt(0).toUpperCase() + pod.room.name.slice(1),
    location: pod.location.name,
    measuredAt: pod.measurements.time ? Date.parse(pod.measurements.time.time) / 1000 : null,
    temperatureF: celsiusToFahrenheit(pod.measurements.temperature),
    humidity: pod.measurements.humidity,
    co2: null, battery: null,
    online: pod.connectionStatus.isAlive,
    error: null, historyError: null, history: [],
    ac: { on: pod.acState.on, mode: pod.acState.mode,
      targetF: target == null ? null : pod.acState.temperatureUnit === "F" ? target : celsiusToFahrenheit(target),
      fan: pod.acState.fanLevel, climateReact: climateReact(pod.smartMode) },
  };
}

function readApiKey(file: string): string {
  const filename = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
  const line = fs.readFileSync(filename, "utf8").split(/\r?\n/).find(value => value.trim().startsWith("SENSIBO_API_KEY="));
  const key = line?.trim().slice("SENSIBO_API_KEY=".length).trim();
  if (!key) throw new Error("Sensibo credentials are not configured.");
  return key;
}

// Each request only reads provider state. Caches are shared across open tabs so
// a dashboard refresh cannot multiply calls to Sensibo or its history endpoint.
export function createClimateReader(fetcher: typeof fetch = fetch, keyReader = readApiKey, clock = Date.now) {
  let configKey = "";
  let cache: { at: number; value: ClimateResult } | null = null;
  let inFlight: Promise<ClimateResult> | null = null;
  const lastGood = new Map<string, ClimateSensor[]>();
  const histories = new Map<string, { at: number; points: ClimatePoint[] }>();

  async function json(url: string, provider: string): Promise<unknown> {
    const response = await fetcher(url, {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", "Accept-Encoding": "gzip" },
    });
    // Never propagate a URL or response body containing the API key to clients.
    if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
    return response.json();
  }

  async function sensibo(config: ClimateConfig): Promise<ClimateSensor[]> {
    let key: string;
    try { key = keyReader(config.sensiboKeyFile); }
    catch { throw new Error("Sensibo credentials could not be read."); }
    const deviceUrl = new URL(`${SENSIBO_API}/users/me/pods`);
    deviceUrl.searchParams.set("apiKey", key);
    deviceUrl.searchParams.set("fields", "id,room,location,measurements,acState,connectionStatus,smartMode");
    const payload = await json(deviceUrl.toString(), "Sensibo") as { status: string; result: SensiboPod[] };
    if (payload.status !== "success" || !Array.isArray(payload.result)) throw new Error("Sensibo did not return its device list.");
    return Promise.all(payload.result.map(async pod => {
      const sensor = sensiboSensor(pod, config.sensorLabels);
      const cached = histories.get(pod.id);
      if (cached && clock() - cached.at < HISTORY_TTL_MS) return { ...sensor, history: cached.points };
      const url = new URL(`${SENSIBO_API}/pods/${encodeURIComponent(pod.id)}/historicalMeasurements`);
      url.searchParams.set("apiKey", key);
      url.searchParams.set("days", "1");
      try {
        const history = await json(url.toString(), "Sensibo history") as { result: { temperature: { time: string; value: number | null }[] } };
        const points = history.result.temperature.flatMap(point => point.value == null ? [] : [{
          ts: Date.parse(point.time) / 1000, temperatureF: celsiusToFahrenheit(point.value)!,
        }]).sort((a, b) => a.ts - b.ts);
        histories.set(pod.id, { at: clock(), points });
        return { ...sensor, history: points };
      } catch {
        return { ...sensor, history: cached?.points ?? [], historyError: "Temperature history could not be updated." };
      }
    }));
  }

  async function aranet(config: ClimateConfig): Promise<ClimateSensor[]> {
    const payload = await json(`${config.hubUrl}/api/cards`, "Room logger") as { cards: HubCard[] };
    return aranetSensors(payload.cards, config.sensorLabels);
  }

  return async (config: ClimateConfig): Promise<ClimateResult> => {
    const nextKey = JSON.stringify(config);
    if (configKey !== nextKey) {
      configKey = nextKey; cache = null; lastGood.clear(); histories.clear();
    }
    if (cache && clock() - cache.at < SNAPSHOT_TTL_MS) return cache.value;
    if (inFlight) return inFlight;
    const request = (async (): Promise<ClimateResult> => {
      const results = await Promise.allSettled([sensibo(config), aranet(config)]);
      const labels = ["Sensibo", "Aranet room logger"];
      const errors: string[] = [];
      const sensors = results.flatMap((result, index) => {
        const provider = labels[index];
        if (result.status === "fulfilled") {
          lastGood.set(provider, result.value);
          return result.value;
        }
        const error = result.reason instanceof Error && /^Sensibo (credentials|returned|did not)/.test(result.reason.message)
          ? result.reason.message : `${provider} could not be reached.`;
        errors.push(error);
        return (lastGood.get(provider) ?? []).map(sensor => ({ ...sensor, error }));
      });
      return { ok: true, locations: groupClimateLocations(sensors), checkedAt: Math.floor(clock() / 1000), timeZone: config.timeZone, errors };
    })();
    inFlight = request;
    try {
      const value = await request;
      cache = { at: clock(), value };
      return value;
    } finally {
      inFlight = null;
    }
  };
}

const readClimate = createClimateReader();

export async function fetchClimate(): Promise<ClimateResult> {
  const config = loadConfig().climate;
  if (!config) return { ok: false, error: "No room sensors are connected to this dashboard yet." };
  return readClimate(config);
}
