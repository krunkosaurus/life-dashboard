export type ClimateConfig = {
  hubUrl: string;
  sensiboKeyFile: string;
  timeZone: string;
  sensorLabels: Record<string, string>;
};

export type ClimatePoint = { ts: number; temperatureF: number };

export type ClimateSensor = {
  id: string;
  kind: "sensibo" | "aranet4";
  label: string;
  area: string;
  location: string;
  measuredAt: number | null;
  temperatureF: number | null;
  humidity: number | null;
  co2: number | null;
  battery: number | null;
  online: boolean;
  error: string | null;
  historyError: string | null;
  history: ClimatePoint[];
  ac: {
    on: boolean; mode: string; targetF: number | null; fan: string;
    // Sensibo's automatic on/off rule ("Climate React"), when it is enabled.
    climateReact: { aboveF: number; aboveOn: boolean; belowF: number; belowOn: boolean } | null;
  } | null;
};

export type ClimateLocation = { id: string; name: string; sensors: ClimateSensor[] };

export type ClimateResult =
  | { ok: true; locations: ClimateLocation[]; checkedAt: number; timeZone: string; errors: string[] }
  | { ok: false; error: string };

export const CLIMATE_STALE_SECONDS = 15 * 60;

export function sensorStatus(sensor: ClimateSensor, now: number): "live" | "stale" | "offline" | "unavailable" {
  if (sensor.error || sensor.measuredAt == null) return "unavailable";
  if (!sensor.online) return "offline";
  return now - sensor.measuredAt > CLIMATE_STALE_SECONDS ? "stale" : "live";
}

export function celsiusToFahrenheit(value: number | null): number | null {
  return value == null ? null : value * 9 / 5 + 32;
}

export function groupClimateLocations(sensors: ClimateSensor[]): ClimateLocation[] {
  const groups = new Map<string, ClimateLocation>();
  for (const sensor of sensors) {
    const id = sensor.location.trim().toLowerCase().replace(/\s+/g, "-");
    if (!groups.has(id)) groups.set(id, { id, name: sensor.location, sensors: [] });
    groups.get(id)!.sensors.push(sensor);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
