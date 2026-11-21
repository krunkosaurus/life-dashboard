"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GpuDevice, GpuHealthResult, GpuHostHealth, GpuProbe } from "@/lib/gpuTypes";
import "./gpu-dashboard.css";

const statusLabels: Record<GpuHostHealth["status"], string> = {
  healthy: "No issues detected", warning: "Needs attention", critical: "Critical",
  unreachable: "Check unavailable", unknown: "Partial readings",
};
const temperature = (c: number | null) => c == null ? "—" : `${Math.round(c * 9 / 5 + 32)}°F`;
const percent = (n: number | null) => n == null ? "—" : `${Math.round(n)}%`;
const gib = (mib: number) => (mib / 1024).toFixed(1);
const ptTime = (ms: number) => new Date(ms).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor(seconds % 3600 / 60)}m`;
}

function ChipIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" /></svg>;
}

export function GpuDashboard() {
  const [data, setData] = useState<GpuHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("All machines");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/gpus", { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The health check failed.");
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // One request on entry. No interval, focus refresh, or visibility polling.
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);

  const hosts = data?.hosts ?? [];
  const reached = hosts.filter(host => host.snapshot != null);
  const attention = hosts.filter(host => host.status !== "healthy");
  const devices = reached.flatMap(host => host.snapshot!.gpus);
  const powerReadings = devices.filter(gpu => gpu.powerW != null);
  const totalPower = powerReadings.reduce((sum, gpu) => sum + gpu.powerW!, 0);
  const updateReadings = reached.filter(host => host.snapshot!.updates.pending != null);
  const pendingUpdates = updateReadings.reduce((sum, host) => sum + host.snapshot!.updates.pending!, 0);
  const groups = ["All machines", ...new Set(hosts.map(host => host.group))];
  const visible = hosts.filter(host => (group === "All machines" || host.group === group) && (!attentionOnly || host.status !== "healthy"));
  const issues = hosts.flatMap(host => host.issues.filter(issue => issue.severity !== "info").map(issue => ({ ...issue, host })))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));

  return (
    <main className="gpu-page">
      <header className="gpu-header">
        <div>
          <div className="gpu-eyebrow"><ChipIcon /> YOUR COMPUTE, AT A GLANCE</div>
          <h1>GPU health</h1>
          <p>Know what’s working, what’s busy, and what needs a closer look.</p>
        </div>
        <div className="gpu-refresh-area">
          <span className="gpu-mode"><i /> On-demand checks</span>
          <button className="gpu-button" onClick={() => void refresh()} disabled={loading}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .4 5M16 3v4h-4" /></svg>
            {loading ? "Checking machines…" : "Refresh snapshot"}
          </button>
        </div>
      </header>

      <div className="gpu-snapshot-note" role="status">
        <span>{loading ? "Taking a fresh snapshot. Slow or unavailable machines may take longer." : data ? `Snapshot · ${ptTime(data.checkedAt)} · ${(data.durationMs / 1000).toFixed(1)}s to check` : "No snapshot available"}</span>
        <span>Checks run when you open this tab or press refresh.</span>
      </div>
      {error && <div className="gpu-error" role="alert">{error} {data && "Showing the previous snapshot; its timestamp is unchanged."}</div>}
      {loading && !data ? <div className="gpu-loading" aria-label="Loading GPU health"><div className="gpu-summary">{[0, 1, 2, 3].map(n => <div className="gpu-stat" key={n}><div className="skel-line" /><div className="skel-line" /></div>)}</div><div className="gpu-machine-grid">{[0, 1, 2, 3].map(n => <div className="gpu-card gpu-card-skeleton" key={n}><div className="skel-line" /><div className="skel-line" /><div className="skel-line" /></div>)}</div></div> : data && hosts.length === 0 ? (
        <div className="gpu-empty"><ChipIcon /><h2>Your GPU fleet belongs here</h2><p>Add your machines to <code>gpuHosts</code> in <code>config.local.json</code>. Each host uses the dashboard machine’s existing SSH access.</p><p>Linux needs Python 3 and NVIDIA tools. Windows uses PowerShell and NVIDIA tools.</p></div>
      ) : data && <>
        <section className="gpu-summary" aria-label="Fleet summary">
          <Summary label="HOSTS REACHED" value={`${reached.length}`} suffix={`/ ${hosts.length}`} note={`${devices.length} GPU${devices.length === 1 ? "" : "s"} reporting`} tone="mint" />
          <Summary label="NEEDS A LOOK" value={`${attention.length}`} note={attention.length ? "Alerts, partial or unavailable checks" : "No issues in the available readings"} tone={attention.length ? "amber" : "mint"} />
          <Summary label="GPU POWER" value={powerReadings.length ? `${Math.round(totalPower)}` : "—"} suffix="W" note={`${powerReadings.length} of ${devices.length} GPUs reporting · snapshot`} tone="blue" />
          <Summary label="CACHED UPDATES" value={updateReadings.length ? `${pendingUpdates}` : "—"} note={`${updateReadings.length} of ${hosts.length} hosts reporting`} tone="purple" />
        </section>

        {issues.length > 0 && <section className="gpu-attention" aria-label="Issues to review">
          <div className="gpu-section-heading"><h2><span className="gpu-alert-symbol">!</span> Worth your attention</h2><span>{issues.length} findings</span></div>
          <div className="gpu-issues-list">{issues.slice(0, 3).map((issue, index) => <a key={`${issue.host.id}-${index}`} className={`gpu-issue gpu-issue-${issue.severity}`} href={`#machine-${issue.host.id}`} onClick={() => { setGroup("All machines"); setAttentionOnly(false); }}><span className="gpu-issue-marker" /><strong>{issue.host.label}</strong><span>{issue.title}</span><span aria-hidden="true">↗</span></a>)}</div>
          {issues.length > 3 && <details className="gpu-more-issues"><summary>Show {issues.length - 3} more findings</summary>{issues.slice(3).map((issue, index) => <a key={`${issue.host.id}-${index}`} className={`gpu-issue gpu-issue-${issue.severity}`} href={`#machine-${issue.host.id}`} onClick={() => { setGroup("All machines"); setAttentionOnly(false); }}><span className="gpu-issue-marker" /><strong>{issue.host.label}</strong><span>{issue.title}</span><span aria-hidden="true">↗</span></a>)}</details>}
        </section>}

        <section aria-label="GPU machines">
          <div className="gpu-fleet-toolbar">
            <div className="gpu-filters" aria-label="Filter machines">{groups.map(label => <button key={label} onClick={() => setGroup(label)} aria-pressed={group === label}>{label}</button>)}</div>
            <label className="gpu-attention-toggle"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} /> Needs attention only</label>
          </div>
          <div className="gpu-machine-grid">{visible.map(host => <MachineCard key={host.id} host={host} />)}</div>
          {visible.length === 0 && <p className="gpu-empty-filter">No machines match this filter.</p>}
        </section>
      </>}

      <section className="gpu-guide">
        <div className="gpu-section-heading"><h2>Make sense of the numbers</h2><span>A quick field guide</span></div>
        <div className="gpu-guide-grid">
          <div><span className="gpu-guide-number">01</span><h3>Busy is not broken</h3><p>High GPU utilization usually means useful work. A single CPU sample can spike. Look for thermal slowdown, errors, or repeated pressure before calling it a problem.</p></div>
          <div><span className="gpu-guide-number">02</span><h3>Memory needs context</h3><p>Models often keep VRAM allocated while idle. Sparks share memory between CPU and GPU, so use available system RAM to judge headroom. An em dash means the sensor did not report.</p></div>
          <div><span className="gpu-guide-number">03</span><h3>Updates are a snapshot, too</h3><p>Counts come from each machine’s local update cache. Zero does not guarantee it is current. Driver versions are shown as installed; pinned kernels and drivers need a coordinated maintenance window.</p></div>
        </div>
        <div className="gpu-guide-footer">Temperatures in °F · Times in Pacific Time, which may be the previous day in Singapore · <a href="https://docs.nvidia.com/deploy/nvidia-smi/index.html" target="_blank" rel="noreferrer">NVIDIA sensor reference ↗</a></div>
      </section>
      <footer className="gpu-footer">Read-only snapshots. No background monitoring, automatic updates, or workload changes. A check already in progress finishes within its timeout if you leave.</footer>
    </main>
  );
}

function Summary({ label, value, suffix, note, tone }: { label: string; value: string; suffix?: string; note: string; tone: string }) {
  return <div className={`gpu-stat gpu-stat-${tone}`}><span className="gpu-stat-label">{label}</span><div className="gpu-stat-value">{value} {suffix && <span>{suffix}</span>}</div><p>{note}</p></div>;
}

function Meter({ label, value, note, tone = "blue" }: { label: string; value: number | null; note?: string; tone?: string }) {
  return <div className={`gpu-meter gpu-meter-${tone}`}><div><span>{label}</span><strong>{percent(value)}</strong></div><div className="gpu-meter-track" role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-valuetext={value == null ? "Not reported" : percent(value)}><span style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></div>{note && <small>{note}</small>}</div>;
}

function Device({ gpu, index, multiple }: { gpu: GpuDevice; index: number; multiple: boolean }) {
  const memoryPercent = gpu.memoryTotalMiB && gpu.memoryUsedMiB != null ? gpu.memoryUsedMiB / gpu.memoryTotalMiB * 100 : null;
  return <div className="gpu-device">
    <div className="gpu-device-name"><ChipIcon /><span>{multiple && `GPU ${index + 1} · `}{gpu.name.replace(/^NVIDIA (GeForce )?/, "")}</span><span className={gpu.thermalSlowdown ? "gpu-thermal-warning" : ""}>{gpu.thermalSlowdown ? "Thermal slowdown" : gpu.utilization == null ? "" : gpu.utilization > 10 ? "Working" : "Low activity"}</span></div>
    <div className="gpu-device-metrics"><div><span>GPU use</span><strong>{percent(gpu.utilization)}</strong></div><div><span>Temperature</span><strong>{temperature(gpu.temperatureC)}</strong></div><div><span>Power draw</span><strong>{gpu.powerW == null ? "—" : `${Math.round(gpu.powerW)} W`}</strong></div></div>
    <Meter label={gpu.memoryTotalMiB == null ? "GPU memory · shared / not reported" : "GPU memory"} value={memoryPercent} note={gpu.memoryTotalMiB != null && gpu.memoryUsedMiB != null ? `${gib(gpu.memoryUsedMiB)} / ${gib(gpu.memoryTotalMiB)} GiB allocated` : "See system RAM for memory headroom"} tone="mint" />
  </div>;
}

function MachineCard({ host }: { host: GpuHostHealth }) {
  const s = host.snapshot;
  const ramUsed = s ? (1 - s.memory.availableMiB / s.memory.totalMiB) * 100 : null;
  return <article id={`machine-${host.id}`} className={`gpu-card gpu-card-${host.status}`}>
    <div className="gpu-card-heading"><div><span className="gpu-machine-group">{host.group}</span><h3>{host.label}</h3></div><span className={`gpu-status gpu-status-${host.status}`}><i />{statusLabels[host.status]}</span></div>
    {s ? <>
      <p className="gpu-host-meta">{s.os} <span>·</span> up {uptime(s.uptimeSeconds)}</p>
      {s.gpus.map((gpu, index) => <Device key={index} gpu={gpu} index={index} multiple={s.gpus.length > 1} />)}
      {s.gpus.length === 0 && <p className="gpu-unavailable-reading">GPU sensors did not return a reading.</p>}
      <div className="gpu-host-meters"><Meter label="CPU" value={s.cpu.utilization} note={`${s.cpu.cores} cores · ${temperature(s.cpu.temperatureC)}`} /><Meter label="System RAM" value={ramUsed} note={`${gib(s.memory.availableMiB)} GiB available / ${gib(s.memory.totalMiB)} GiB`} tone={ramUsed != null && ramUsed > 90 ? "amber" : "purple"} /></div>
      <div className="gpu-card-strip"><span>Driver <strong>{s.driver ?? "—"}</strong></span><span className={s.updates.rebootRequired ? "gpu-thermal-warning" : ""}>{s.updates.rebootRequired ? "Restart pending" : s.updates.pending == null ? "Updates unknown" : `${s.updates.pending} cached updates`}</span></div>
    </> : <div className="gpu-unreachable"><span aria-hidden="true">⌁</span><p>Couldn’t read this machine.</p><small>Unavailable checks don’t mean the GPU has failed.</small></div>}
    {host.issues.length > 0 && <div className="gpu-card-findings">{host.issues.slice(0, 2).map((issue, index) => <p key={index} className={`gpu-finding-${issue.severity}`}><span aria-hidden="true">{issue.severity === "info" ? "i" : "!"}</span>{issue.title}</p>)}{host.issues.length > 2 && <small>+{host.issues.length - 2} more in details</small>}</div>}
    <details className="gpu-details"><summary>Machine details <span>Readings, updates & issues</span></summary>
      <div className="gpu-details-body">
        <p className="gpu-checked">Checked {ptTime(host.checkedAt)} · {(host.durationMs / 1000).toFixed(1)}s</p>
        {host.issues.map((issue, index) => <div className={`gpu-detail-issue gpu-detail-${issue.severity}`} key={index}><strong>{issue.title}</strong><p>{issue.detail}</p></div>)}
        {s && <MachineDetails snapshot={s} />}
      </div>
    </details>
  </article>;
}

function MachineDetails({ snapshot: s }: { snapshot: GpuProbe }) {
  const cacheAgeDays = s.updates.checkedAt == null ? null : Math.max(0, Math.floor(Date.now() / 1000 - s.updates.checkedAt) / 86400);
  return <>
    <h4>System</h4><dl className="gpu-detail-values"><div><dt>Processor</dt><dd>{s.cpu.name}</dd></div><div><dt>CPU load · 1 min</dt><dd>{s.cpu.load1?.toFixed(2) ?? "Not reported"}</dd></div><div><dt>Swap in use</dt><dd>{s.memory.swapUsedMiB == null ? "Not reported" : `${gib(s.memory.swapUsedMiB)} GiB`}</dd></div><div><dt>Driver CUDA support</dt><dd>{s.cuda ?? "Not reported"}</dd></div></dl>
    <h4>Storage</h4><dl className="gpu-detail-values">{s.disks.map(disk => <div key={disk.mount}><dt>{disk.mount}</dt><dd>{disk.freeGiB.toFixed(1)} GiB free / {disk.totalGiB.toFixed(1)} GiB</dd></div>)}</dl>
    <h4>Updates</h4><dl className="gpu-detail-values"><div><dt>Pending / security</dt><dd>{s.updates.pending ?? "Unknown"} / {s.updates.security ?? "Unknown"}</dd></div><div><dt>Update cache</dt><dd>{s.updates.checkedAt == null ? "Age unknown" : ptTime(s.updates.checkedAt * 1000)}</dd></div><div><dt>Restart required</dt><dd>{s.updates.rebootRequired == null ? "Unknown" : s.updates.rebootRequired ? "Yes" : "No"}</dd></div></dl><p className="gpu-detail-note">{s.updates.source}. {cacheAgeDays == null ? "Cache freshness is unknown." : cacheAgeDays >= 2 ? `Cache is ${Math.floor(cacheAgeDays)} days old; update counts may be outdated.` : "Counts reflect the last local update scan."} Installed driver versions are not compared against online releases.</p>
    {s.gpus.length > 0 && <><h4>GPU diagnostics</h4><dl className="gpu-detail-values">{s.gpus.map((gpu, index) => <div key={index}><dt>{s.gpus.length > 1 ? `GPU ${index + 1}` : "GPU"}</dt><dd>Fan {percent(gpu.fanPercent)} · limit {gpu.powerLimitW == null ? "—" : `${Math.round(gpu.powerLimitW)} W`} · ECC {gpu.uncorrectedErrors ?? "not reported"}</dd></div>)}</dl></>}
    {s.events.length > 0 && <><h4>Recent system errors · last 24 hours</h4><p className="gpu-detail-note">Up to 30 recent kernel or Windows System errors, rather than a total error count.</p><div className="gpu-event-log">{s.events.map((event, index) => <div key={index}><time>{ptTime(event.at * 1000)}</time><p>{event.message}</p></div>)}</div></>}
    {s.limitations.length > 0 && <><h4>Collection notes</h4><ul className="gpu-collection-notes">{s.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul></>}
    <p className="gpu-detail-note">CPU temperatures, fan speeds, ECC counters, and dedicated VRAM may not be exposed by every device. A snapshot cannot establish long-term stability.</p>
  </>;
}
