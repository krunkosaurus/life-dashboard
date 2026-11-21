"use client";

import { useCallback, useEffect, useState } from "react";
import { ClimateChart } from "./ClimateChart";
import { sensorStatus } from "@/lib/climateTypes";
import type { ClimateLocation, ClimateResult, ClimateSensor } from "@/lib/climateTypes";

function age(ts: number | null, now: number): string {
  if (ts == null) return "No reading yet";
  const minutes = Math.max(0, Math.floor((now - ts) / 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m ago` : `${Math.floor(hours / 24)} days ago`;
}

function SensorCard({ sensor, now, timeZone }: { sensor: ClimateSensor; now: number; timeZone: string }) {
  const status = sensorStatus(sensor, now);
  const formattedTime = sensor.measuredAt == null ? "No measurement yet" : new Intl.DateTimeFormat("en-SG", {
    timeZone, dateStyle: "medium", timeStyle: "short",
  }).format(new Date(sensor.measuredAt * 1000));
  const hourAgo = now - 3600;
  const first = sensor.history.find(point => point.ts >= hourAgo && point.ts <= hourAgo + 10 * 60);
  const change = first && sensor.temperatureF != null ? sensor.temperatureF - first.temperatureF : null;
  const trend = change == null ? null : Math.abs(change) < 0.2 ? "Steady over the past hour" : `${change > 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(1)}° over the past hour`;
  return (
    <article className={`climate-sensor climate-sensor-${sensor.kind}`}>
      <div className="climate-sensor-top"><span className="climate-device-label">{sensor.kind === "aranet4" ? "Aranet4" : "Sensibo"}</span><span className={`climate-status climate-status-${status}`}><i />{status === "live" ? "Reporting" : status === "unavailable" ? "Update unavailable" : status === "stale" ? "Stale reading" : "Device offline"}</span></div>
      <h3>{sensor.area}</h3>
      <div className={`climate-temperature ${status !== "live" ? "climate-temperature-muted" : ""}`}>{sensor.temperatureF == null ? "—" : sensor.temperatureF.toFixed(1)}<span>°F</span></div>
      <div className="climate-reading-age" title={formattedTime}>{age(sensor.measuredAt, now)}{trend && <span>{trend}</span>}</div>
      <dl className="climate-sensor-metrics">
        <div><dt>Humidity</dt><dd>{sensor.humidity == null ? "—" : `${sensor.humidity.toFixed(0)}%`}</dd></div>
        {sensor.co2 != null && <div><dt>CO₂</dt><dd>{sensor.co2.toLocaleString()} <span>ppm</span></dd></div>}
        {sensor.battery != null && <div><dt>Battery</dt><dd>{sensor.battery}%</dd></div>}
      </dl>
      {sensor.ac && <div className="climate-ac-state"><span className={`climate-ac-indicator ${sensor.ac.on ? "is-on" : ""}`} />
        <strong>AC {sensor.ac.on ? "on" : "off"}</strong><span>{sensor.ac.mode}{sensor.ac.targetF != null ? ` · ${Math.round(sensor.ac.targetF)}°F target` : ""} · {sensor.ac.fan.replaceAll("_", " ")} fan</span>
      </div>}
      {sensor.error && <p className="climate-sensor-error">{sensor.error} Showing the last received reading.</p>}
      {sensor.historyError && <p className="climate-sensor-error">{sensor.historyError}</p>}
    </article>
  );
}

function LocationCard({ location, now, checkedAt, timeZone }: {
  location: ClimateLocation; now: number; checkedAt: number; timeZone: string;
}) {
  const live = location.sensors.filter(sensor => sensorStatus(sensor, now) === "live").length;
  return (
    <section className="climate-location" aria-label={`${location.name} climate`}>
      <header className="climate-location-header"><div><span className="climate-eyebrow">LOCATION</span><h2>{location.name}</h2></div><span className="climate-location-count">{live} / {location.sensors.length} reporting</span></header>
      <div className="climate-sensors">{location.sensors.map(sensor => <SensorCard key={sensor.id} sensor={sensor} now={now} timeZone={timeZone} />)}</div>
      <ClimateChart location={location.name} sensors={location.sensors} checkedAt={checkedAt} timeZone={timeZone} />
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
  return (
    <main className="locations-page">
      <header className="locations-header"><div><p className="climate-eyebrow">LIFE DASHBOARD / LOCATIONS</p><h1>Your spaces, at a glance.</h1><p className="locations-description">Room temperatures and the systems keeping them cool.</p></div>
        <div className="locations-refresh"><span>{snapshot ? `Checked ${age(snapshot.checkedAt, now).toLowerCase()}` : "Connecting to your sensors"}</span><button onClick={() => void refresh()} disabled={loading} className="locations-refresh-button">{loading ? "Refreshing…" : "↻ Refresh"}</button></div>
      </header>
      {snapshot && <div className="climate-overview"><span><strong>{snapshot.locations.length}</strong> locations</span><span><strong>{sensors.length}</strong> monitors</span><span><i className="climate-overview-dot" /><strong>{live}</strong> reporting</span><span className="climate-overview-zone">Fahrenheit · {snapshot.timeZone} ({zoneLabel})</span></div>}
      {errors.length > 0 && <div className="climate-alert" role="status">{errors.map(error => <p key={error}>{error}</p>)}</div>}
      {data && !data.ok && <div className="climate-empty"><h2>Connect your room sensors</h2><p>{data.error}</p></div>}
      {!data && !requestError && <div className="climate-locations-grid" aria-label="Loading locations">{[0, 1].map(index => <div key={index} className="climate-location climate-loading"><div className="skel-line" /><div className="skel-line" /><div className="skel-line" /></div>)}</div>}
      {snapshot && snapshot.locations.length === 0 && <div className="climate-empty"><h2>No readings available</h2><p>Your locations will appear when a connected sensor reports.</p></div>}
      {snapshot && <div className="climate-locations-grid">{snapshot.locations.map(location => <LocationCard key={location.id} location={location} now={now} checkedAt={snapshot.checkedAt} timeZone={snapshot.timeZone} />)}</div>}
      <footer className="locations-footer">Readings refresh every minute. Device timestamps show when the room was measured. AC state reflects the last reported command.</footer>
    </main>
  );
}
