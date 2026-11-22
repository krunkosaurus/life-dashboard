import { describe, expect, it, vi } from "vitest";
import { createClimateReader, sensiboSensor } from "../climate";
import { parseClimateConfig } from "../climateConfig";
import { celsiusToFahrenheit, sensorStatus } from "../climateTypes";
import { endLabelOffsets, temperatureTicks } from "../climateChart";

const epoch = Date.parse("2026-10-23T06:00:00Z");
const config = parseClimateConfig({ hubUrl: "http://room-logger:8787", timeZone: "Asia/Singapore" })!;
const pod = (id: string, location: string) => ({
  id, location: { name: location, address: ["private-address"], latLon: [1, 2] },
  room: { name: "Server room" },
  measurements: { time: { time: "2026-10-23T05:59:30Z" }, temperature: 30, humidity: 45 },
  connectionStatus: { isAlive: true },
  acState: { on: false, mode: "cool", targetTemperature: 24, temperatureUnit: "C", fanLevel: "auto" },
});
const hub = { cards: [{ id: "aranet4-example", kind: "aranet4", label: "Aranet4", place: "East site", area: "GPU desk",
  latest: { ts: epoch / 1000 - 120, temperature_c: 31, humidity_pct: 36, co2_ppm: 500 },
  battery_pct: 99, last_error: null, last_error_ts: null, last_ok_ts: epoch / 1000 - 100, log_error: null,
  trend: [[epoch / 1000 - 300, 31.2], [epoch / 1000 - 120, 31]] }] };

function provider() {
  const state = { hubDown: false, sensiboDown: false, historyDown: false };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    const parsed = new URL(String(url));
    if (parsed.hostname === "room-logger") {
      if (state.hubDown) throw new Error("private-hub-url is unreachable");
      return Response.json(hub);
    }
    if (state.sensiboDown) throw new Error("request failed with test-api-key in its URL");
    if (parsed.pathname.endsWith("/historicalMeasurements")) {
      expect(parsed.searchParams.get("days")).toBe("1");
      if (state.historyDown) return new Response("unavailable", { status: 429 });
      return Response.json({ result: { temperature: [{ time: "2026-10-23T05:50:00Z", value: 29 }, { time: "2026-10-23T05:59:30Z", value: 30 }] } });
    }
    return Response.json({ status: "success", result: [pod("EastDevice", "East site"), pod("NewWestDevice", "West site")] });
  });
  return { state, fetcher: fetcher as unknown as typeof fetch, mock: fetcher };
}

describe("location climate readings", () => {
  it("groups a newly added Sensibo at its own location alongside an existing Aranet", async () => {
    const { fetcher } = provider();
    const read = createClimateReader(fetcher, () => "test-api-key", () => epoch);
    const result = await read(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.locations.map(site => [site.name, site.sensors.length])).toEqual([["East site", 2], ["West site", 1]]);
    const west = result.locations[1].sensors[0];
    expect(west.temperatureF).toBe(86);
    expect(west.ac).toMatchObject({ on: false, targetF: 75.2 });
    expect(west.history).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/test-api-key|private-address|latLon|apiKey/);
  });

  it("asks Sensibo for Climate React settings in the same device-list request", async () => {
    const { fetcher, mock } = provider();
    await createClimateReader(fetcher, () => "test-api-key", () => epoch)(config);
    const list = mock.mock.calls.map(([url]) => new URL(String(url))).find(url => url.pathname.endsWith("/users/me/pods"))!;
    expect(list.searchParams.get("fields")?.split(",")).toContain("smartMode");
  });

  it("explains an enabled Climate React rule in Fahrenheit and ignores a disabled one", () => {
    const rule = {
      enabled: true, type: "temperature", lowTemperatureThreshold: 26.11111111111111, highTemperatureThreshold: 32.22222222222222,
      lowTemperatureState: { on: false }, highTemperatureState: { on: true },
    };
    const sensor = sensiboSensor({ ...pod("device", "Site"), smartMode: rule }, {});
    expect(sensor.ac?.climateReact).toEqual({ aboveF: 90, aboveOn: true, belowF: 79, belowOn: false });
    expect(sensiboSensor({ ...pod("device", "Site"), smartMode: { ...rule, enabled: false } }, {}).ac?.climateReact).toBeNull();
    expect(sensiboSensor({ ...pod("device", "Site"), smartMode: null }, {}).ac?.climateReact).toBeNull();
  });

  it("names a Sensibo by its configured label, else its capitalized Sensibo room name", () => {
    const bedroom = { ...pod("Bed", "Site"), room: { name: "bedroom" } };
    expect(sensiboSensor(bedroom, {}).area).toBe("Bedroom");
    expect(sensiboSensor(bedroom, { "sensibo-bed": "Guest room" }).area).toBe("Guest room");
  });

  it("puts temperature gridlines on round, evenly spaced degrees", () => {
    expect(temperatureTicks(73.5, 81)).toEqual([72, 74, 76, 78, 80, 82]);
    expect(temperatureTicks(74.8, 88.5)).toEqual([70, 75, 80, 85, 90]);
    expect(temperatureTicks(73.76, 73.9)).toEqual([72, 73, 74, 75]);
  });

  it("keeps line-end labels apart: the top line labelled above, the rest below", () => {
    expect(endLabelOffsets([100, 40])).toEqual([16, -8]);
    expect(endLabelOffsets([50, 52])).toEqual([-8, 16]);
    const close = endLabelOffsets([60, 61, 62]);
    expect(61 + close[1] - (60 + close[0])).toBeGreaterThanOrEqual(13);
    expect(62 + close[2] - (61 + close[1])).toBeGreaterThanOrEqual(13);
  });

  it("preserves missing measurements and distinguishes an offline device from a fresh one", () => {
    expect(celsiusToFahrenheit(null)).toBeNull();
    expect(celsiusToFahrenheit(0)).toBe(32);
    const sensor = sensiboSensor(pod("device", "Site"), {});
    expect(sensorStatus(sensor, epoch / 1000)).toBe("live");
    expect(sensorStatus(sensor, epoch / 1000 + 900)).toBe("stale");
    expect(sensorStatus({ ...sensor, online: false }, epoch / 1000)).toBe("offline");
    expect(sensorStatus({ ...sensor, error: "read failed" }, epoch / 1000)).toBe("unavailable");
  });

  it("shares reads across tabs and fetches history only once per five minutes", async () => {
    const { fetcher, mock } = provider();
    let now = epoch;
    const read = createClimateReader(fetcher, () => "test-api-key", () => now);
    await Promise.all([read(config), read(config)]);
    expect(mock).toHaveBeenCalledTimes(4);
    await read(config);
    expect(mock).toHaveBeenCalledTimes(4);
    now += 61_000;
    await read(config);
    expect(mock).toHaveBeenCalledTimes(6);
    now += 5 * 60_000;
    await read(config);
    expect(mock).toHaveBeenCalledTimes(10);
  });

  it("retains last readings with an explicit failure while the other provider stays live", async () => {
    const { fetcher, state } = provider();
    let now = epoch;
    const read = createClimateReader(fetcher, () => "test-api-key", () => now);
    await read(config);
    state.sensiboDown = true;
    now += 61_000;
    const result = await read(config);
    if (!result.ok) throw new Error(result.error);
    expect(result.locations).toHaveLength(2);
    const sensors = result.locations.flatMap(location => location.sensors);
    expect(sensors.filter(sensor => sensor.kind === "sensibo").every(sensor => sensorStatus(sensor, now / 1000) === "unavailable")).toBe(true);
    expect(sensorStatus(sensors.find(sensor => sensor.kind === "aranet4")!, now / 1000)).toBe("live");
    expect(result.errors).toEqual(["Sensibo could not be reached."]);
    expect(JSON.stringify(result)).not.toContain("test-api-key");
  });

  it("keeps current temperatures visible when historical measurements fail", async () => {
    const { fetcher, state } = provider();
    state.historyDown = true;
    const result = await createClimateReader(fetcher, () => "test-api-key", () => epoch)(config);
    if (!result.ok) throw new Error(result.error);
    const sensor = result.locations[1].sensors[0];
    expect(sensor.temperatureF).toBe(86);
    expect(sensor.history).toEqual([]);
    expect(sensor.historyError).toBeTruthy();
    expect(sensorStatus(sensor, epoch / 1000)).toBe("live");
  });
});
