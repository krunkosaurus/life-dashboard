"use client";

import { useCallback, useEffect, useState } from "react";
import { ClimateChart } from "./ClimateChart";
import { sensorStatus } from "@/lib/climateTypes";
import type { ClimateLocation, ClimateResult, ClimateSensor } from "@/lib/climateTypes";

// Validated against the card surface for color-blind separation and contrast.
// A sensor keeps its color on both its card and its chart line.
const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];

function age(ts: number | null, now: number): string {
  if (ts == null) return "never";
  const minutes = Math.max(0, Math.floor((now - ts) / 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min ago` : `${Math.floor(hours / 24)} days ago`;
}

function freshness(sensor: ClimateSensor, now: number): { text: string; warn: boolean } {
  switch (sensorStatus(sensor, now)) {
    case "live": return { text: `updated ${age(sensor.measuredAt, now)}`, warn: false };
    case "stale": return { text: `no update since ${age(sensor.measuredAt, now)}`, warn: true };
    case "offline": return { text: `offline, last reading ${age(sensor.measuredAt, now)}`, warn: true };
    default: return { text: sensor.measuredAt == null ? "no reading yet" : `last reading ${age(sensor.measuredAt, now)}`, warn: true };
  }
}

function hourTrend(sensor: ClimateSensor, now: number): string | null {
  const hourAgo = now - 3600;
  const first = sensor.history.find(point => point.ts >= hourAgo && point.ts <= hourAgo + 10 * 60);
  if (!first || sensor.temperatureF == null) return null;
  const change = sensor.temperatureF - first.temperatureF;
  if (Math.abs(change) < 0.2) return "Steady over the last hour";
  return `${change > 0 ? "Up" : "Down"} ${Math.abs(change).toFixed(1)}° in the last hour`;
}

function acMode(ac: NonNullable<ClimateSensor["ac"]>): string {
  const target = ac.targetF == null ? "" : ` to ${Math.round(ac.targetF)}°F`;
  return ({ cool: `cooling${target}`, heat: `heating${target}`, dry: "drying", fan: "fan only", auto: `auto${target}` } as Record<string, string>)[ac.mode] ?? ac.mode;
}

function climateReactRule(rule: NonNullable<ClimateSensor["ac"]>["climateReact"]): string | null {
  if (!rule) return null;
  return `Climate React turns it ${rule.aboveOn ? "on" : "off"} above ${rule.aboveF}°F and ${rule.belowOn ? "on" : "off"} below ${rule.belowF}°F.`;
}

function SensorCard({ sensor, color, now }: { sensor: ClimateSensor; color: string; now: number }) {
  const live = sensorStatus(sensor, now) === "live";
  const fresh = freshness(sensor, now);
  const trend = hourTrend(sensor, now);
  const rule = sensor.ac && climateReactRule(sensor.ac.climateReact);
  return (
    <article className="climate-sensor" aria-label={`${sensor.area}, ${sensor.temperatureF == null ? "no reading" : `${sensor.temperatureF.toFixed(1)}°F`}`}>
      <header>
        <h3><i className="climate-swatch" style={{ background: color }} aria-hidden="true" />{sensor.area}</h3>
        <p className={fresh.warn ? "climate-sensor-meta is-warn" : "climate-sensor-meta"}>
          <span title={sensor.label}>{sensor.kind === "aranet4" ? "Aranet4" : "Sensibo Sky"}</span>, {fresh.text}
        </p>
      </header>
      <div className="climate-reading">
        <div className={live ? "climate-temperature" : "climate-temperature is-muted"}>
          {sensor.temperatureF == null ? "—" : sensor.temperatureF.toFixed(1)}<span>°F</span>
        </div>
        {trend && <p className="climate-trend">{trend}</p>}
      </div>
      <dl className="climate-sensor-metrics">
        <div><dt>Humidity</dt><dd>{sensor.humidity == null ? "—" : `${sensor.humidity.toFixed(0)}%`}</dd></div>
        {sensor.co2 != null && <div><dt>CO₂</dt><dd>{sensor.co2.toLocaleString()} <span>ppm</span></dd></div>}
        {sensor.battery != null && <div><dt>Battery</dt><dd>{sensor.battery}%</dd></div>}
      </dl>
      <footer>
        {sensor.ac && <div className="climate-ac">
          <p><span className={sensor.ac.on ? "climate-ac-dot is-on" : "climate-ac-dot"} aria-hidden="true" />
            <strong>AC {sensor.ac.on ? "on" : "off"}</strong>
            {sensor.ac.on && <>, {acMode(sensor.ac)}, <span className="climate-nowrap">{sensor.ac.fan.replaceAll("_", "-")} fan</span></>}</p>
          {rule && <p className="climate-ac-rule">{rule}</p>}
        </div>}
        {sensor.error && <p className="climate-sensor-error">{sensor.error} Showing the last reading received.</p>}
        {sensor.historyError && <p className="climate-sensor-error">{sensor.historyError}</p>}
      </footer>
    </article>
  );
}

function LocationCard({ location, now, checkedAt, timeZone }: {
  location: ClimateLocation; now: number; checkedAt: number; timeZone: string;
}) {
  const quiet = location.sensors.filter(sensor => sensorStatus(sensor, now) !== "live").length;
  const colored = location.sensors.map((sensor, index) => ({ sensor, color: SERIES_COLORS[index % SERIES_COLORS.length] }));
  return (
    <section className="climate-location" aria-labelledby={`location-${location.id}`}>
      <header className="climate-location-header">
        <h2 id={`location-${location.id}`}>{location.name}</h2>
        {quiet > 0 && <span className="climate-location-warning">{quiet === 1 ? "1 sensor isn't" : `${quiet} sensors aren't`} reporting</span>}
      </header>
      <div className="climate-sensors">{colored.map(({ sensor, color }) => <SensorCard key={sensor.id} sensor={sensor} color={color} now={now} />)}</div>
      <ClimateChart location={location.name} checkedAt={checkedAt} timeZone={timeZone}
        series={colored.map(({ sensor, color }) => ({ id: sensor.id, name: sensor.area, color, points: sensor.history }))} />
    </section>
  );
}

export function LocationsDashboard() {
  const [data, setData] = useState<ClimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/locations", { cache: "no-store", signal });
      if (!response.ok) throw new Error("The latest readings could not be loaded.");
      setData(await response.json());
      setRequestError(null);
    } catch (error) {
      if (signal?.aborted) return;
      setRequestError(error instanceof Error ? error.message : "The latest readings could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = setInterval(() => void refresh(controller.signal), 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refresh]);

  const snapshot = data?.ok ? data : null;
  const now = Math.floor(Date.now() / 1000);
  const sensors = snapshot?.locations.flatMap(location => location.sensors) ?? [];
  const live = sensors.filter(sensor => sensorStatus(sensor, now) === "live").length;
  const errors = [...(snapshot?.errors ?? []), ...(requestError ? [requestError] : [])];
  const zoneLabel = snapshot ? new Intl.DateTimeFormat("en-SG", { timeZone: snapshot.timeZone, timeZoneName: "short" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value : null;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const summary = !snapshot ? "Connecting to your room sensors…"
    : `${plural(sensors.length, "sensor")} in ${plural(snapshot.locations.length, "location")}, ${live === sensors.length ? "all reporting" : `${live} reporting`}.`;
  return (
    <main className="locations-page">
      <header className="locations-header">
        <div><h1>Locations</h1><p>{summary}</p></div>
        <div className="locations-refresh">
          {snapshot && <span>Updated {age(snapshot.checkedAt, now)}</span>}
          <button onClick={() => void refresh()} disabled={loading} className="locations-refresh-button">{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>
      {errors.length > 0 && <div className="climate-alert" role="status">{errors.map(error => <p key={error}>{error}</p>)}</div>}
      {data && !data.ok && <div className="climate-empty"><h2>Connect your room sensors</h2><p>{data.error}</p></div>}
      {!data && !requestError && <div className="climate-locations-grid" aria-label="Loading locations">{[0, 1].map(index => <div key={index} className="climate-location climate-loading"><div className="skel-line" /><div className="skel-line" /><div className="skel-line" /></div>)}</div>}
      {snapshot && snapshot.locations.length === 0 && <div className="climate-empty"><h2>No readings yet</h2><p>A location appears here once one of its sensors reports.</p></div>}
      {snapshot && <div className="climate-locations-grid">{snapshot.locations.map(location => <LocationCard key={location.id} location={location} now={now} checkedAt={snapshot.checkedAt} timeZone={snapshot.timeZone} />)}</div>}
      <footer className="locations-footer">
        Readings refresh every minute.{snapshot && zoneLabel && ` Times are ${zoneLabel} (${snapshot.timeZone}).`} AC on or off is the last state Sensibo recorded.
      </footer>
    </main>
  );
}
