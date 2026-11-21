import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { loadConfig } from "./config";
import type { GpuHealthResult, GpuHostConfig, GpuHostHealth, GpuIssue, GpuProbe } from "./gpuTypes";

export function assessGpuHealth(probe: GpuProbe): Pick<GpuHostHealth, "issues" | "status"> {
  const issues: GpuIssue[] = [];
  const add = (severity: GpuIssue["severity"], title: string, detail: string) => issues.push({ severity, title, detail });
  const fahrenheit = (c: number) => `${Math.round(c * 9 / 5 + 32)}°F`;
  for (const [index, gpu] of probe.gpus.entries()) {
    const name = probe.gpus.length > 1 ? `GPU ${index + 1}` : "GPU";
    if (gpu.thermalSlowdown) {
      add("critical", `${name} is thermally throttling`, "The driver reports active thermal slowdown. Check cooling, airflow, and fan operation before adding work.");
    } else if (gpu.thermalHeadroomC != null && gpu.thermalHeadroomC <= 5) {
      add("warning", `${name} is near its thermal limit`, `Only ${Math.round(gpu.thermalHeadroomC * 9 / 5)}°F of temperature headroom reported by the driver. Check cooling and workload.`);
    } else if (gpu.temperatureC != null && gpu.temperatureC >= 85) {
      add("warning", `${name} is running hot`, `${fahrenheit(gpu.temperatureC)} meets this dashboard's 185°F review threshold. This is a general alert threshold, not the card's rated limit.`);
    }
    if (gpu.uncorrectedErrors != null && gpu.uncorrectedErrors > 0) {
      add("critical", `${name} reports memory errors`, `${gpu.uncorrectedErrors} uncorrected ECC errors since the driver loaded. Review hardware diagnostics and workload errors.`);
    }
    if (gpu.memoryUsedMiB != null && gpu.memoryTotalMiB != null && gpu.memoryTotalMiB > 0 && gpu.memoryUsedMiB / gpu.memoryTotalMiB >= 0.95) {
      add("info", `${name} memory is nearly full`, "At least 95% is allocated. Resident models can use most VRAM normally; check free memory before starting another workload.");
    }
  }
  if (probe.gpus.length === 0) add("warning", "GPU readings unavailable", "The host answered, but the NVIDIA driver did not return GPU data. Check driver access and the collection notes.");
  const availablePercent = probe.memory.availableMiB / probe.memory.totalMiB * 100;
  if (availablePercent < 10) {
    add(availablePercent < 5 ? "critical" : "warning", "Little system memory available", `${availablePercent.toFixed(1)}% RAM available; flagged below 10% (critical below 5%). Spark CPU and GPU share this pool. Review resident workloads before adding more.`);
  }
  if (probe.cpu.utilization != null && probe.cpu.utilization >= 95) {
    add("info", "CPU was busy during this sample", `${Math.round(probe.cpu.utilization)}% utilization. A single busy sample is not a fault; refresh later to see whether it persists.`);
  }
  if (probe.cpu.temperatureC != null && probe.cpu.temperatureC >= 90) {
    add("warning", "CPU temperature needs attention", `${fahrenheit(probe.cpu.temperatureC)} meets the dashboard's 194°F review threshold. Check cooling and the processor's specifications.`);
  }
  for (const disk of probe.disks) {
    const free = disk.freeGiB / disk.totalGiB * 100;
    if (free < 15) add(free < 5 ? "critical" : "warning", `${disk.mount} is running low on space`, `${disk.freeGiB.toFixed(1)} GiB free (${free.toFixed(1)}%). Review space below 15%; below 5% is critical. Model downloads and logs need room to grow.`);
  }
  if (probe.updates.rebootRequired) add("warning", "Restart pending", "The OS reports a pending restart. Schedule it around active GPU work.");
  if (probe.updates.security != null && probe.updates.security > 0) {
    add("warning", "Security updates in local cache", `${probe.updates.security} security update${probe.updates.security === 1 ? " appears" : "s appear"} in the local cache. Check its age in machine details, and review pinned driver/kernel versions before applying updates.`);
  }
  if (probe.services.length > 0) add("warning", "Failed system services", `${probe.services.length} failed unit(s): ${probe.services.map(service => service.name).join(", ")}. Inspect these services to determine the impact.`);
  if (probe.events.some(event => /out of memory|oom-kill|Killed process/i.test(event.message))) {
    add("warning", "An out-of-memory kill was logged", "The last 24 hours include a process killed for lack of memory. Review the timestamp and affected workload in the error log; this does not mean memory is exhausted now.");
  }
  if (probe.events.some(event => /NVRM:.*Xid|dxgk:|GPU has fallen off/i.test(event.message))) {
    add("warning", "GPU driver errors were logged", "The recent system-log sample includes NVIDIA or WSL GPU-driver errors. Review the messages alongside workload failures before choosing a repair.");
  }
  if (probe.events.length > 0) add("warning", "Recent system errors", `${probe.events.length} ${probe.events.length === 1 ? "entry" : "entries"} in the bounded error-log sample from the last 24 hours. Open machine details to review them; these are not necessarily ongoing failures.`);
  const status = issues.some(issue => issue.severity === "critical") ? "critical"
    : issues.some(issue => issue.severity === "warning") ? "warning"
    : probe.limitations.length > 0 ? "unknown" : "healthy";
  return { issues, status };
}

export function parseProbeOutput(stdout: string): GpuProbe {
  // Shared Spark hosts print a lease banner before the command's JSON.
  const line = stdout.trim().split(/\r?\n/).reverse().find(value => value.startsWith("{"));
  if (!line) throw new Error("The host returned no health snapshot.");
  const result = JSON.parse(line) as GpuProbe;
  if (result.schema !== 1 || !Array.isArray(result.gpus)) throw new Error("The host returned an unsupported health snapshot.");
  return result;
}

export function describeGpuError(error: unknown): string {
  const e = error as { message?: string; stderr?: string; killed?: boolean };
  const detail = `${e.stderr ?? ""} ${e.message ?? ""}`;
  if (/Permission denied|authentication failed/i.test(detail)) return "SSH authentication was refused. Check the dashboard user's key and the host's login session.";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(detail)) return "SSH host identity needs verification in this machine's known_hosts file.";
  if (/Could not resolve hostname/i.test(detail)) return "The SSH hostname could not be resolved. Check its SSH alias or tailnet connection.";
  if (e.killed || /timed out|ETIMEDOUT/i.test(detail)) return "The check exceeded its time limit. The machine may be busy, sleeping, or on a slow network; this does not prove it is offline.";
  if (/Connection refused|No route to host|Network is unreachable/i.test(detail)) return "SSH could not reach this host. Check power, network connectivity, and the SSH service.";
  return "The health check did not complete. Check SSH access and the host's Python 3 or PowerShell installation.";
}

export function windowsProbeCommand(script: string): string {
  // Windows OpenSSH does not reliably deliver EOF to PowerShell's Console.In.
  // Compress the script into the command to stay within cmd.exe's 8191 limit.
  const payload = gzipSync(Buffer.from(script, "utf8")).toString("base64");
  const bootstrap = `$m=[IO.MemoryStream]::new([Convert]::FromBase64String('${payload}'));iex ([IO.StreamReader]::new([IO.Compression.GzipStream]::new($m,[IO.Compression.CompressionMode]::Decompress))).ReadToEnd()`;
  return `powershell.exe -NoP -NonI -Enc ${Buffer.from(bootstrap, "utf16le").toString("base64")}`;
}

function executeProbe(host: GpuHostConfig, script: string): Promise<string> {
  const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "-o", "StrictHostKeyChecking=yes", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none"];
  if (host.jumpHost) args.push("-J", host.jumpHost);
  args.push(host.sshHost);
  args.push(host.platform === "windows" ? windowsProbeCommand(script) : "python3 -");
  return new Promise((resolve, reject) => {
    const child = execFile("ssh", args, { timeout: 35_000, maxBuffer: 512 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }));
      else resolve(stdout);
    });
    // Failed connections can close stdin before the script is delivered.
    child.stdin?.on("error", () => {});
    child.stdin?.end(host.platform === "linux" ? script : undefined);
  });
}

async function checkHost(host: GpuHostConfig, script: string): Promise<GpuHostHealth> {
  const start = Date.now();
  const base = { id: host.id, label: host.label, group: host.group };
  try {
    const snapshot = parseProbeOutput(await executeProbe(host, script));
    return { ...base, ...assessGpuHealth(snapshot), snapshot, checkedAt: Date.now(), durationMs: Date.now() - start };
  } catch (error) {
    return { ...base, status: "unreachable", snapshot: null, checkedAt: Date.now(), durationMs: Date.now() - start,
      issues: [{ severity: "warning", title: "Health check unavailable", detail: describeGpuError(error) }] };
  }
}

// Concurrent visits share only work in progress. No timer or scheduled scans.
let inFlight: { key: string; promise: Promise<GpuHealthResult> } | null = null;
export function fetchGpuHealth(): Promise<GpuHealthResult> {
  const hosts = loadConfig().gpuHosts;
  const key = JSON.stringify(hosts);
  if (inFlight?.key === key) return inFlight.promise;
  const promise = collect(hosts);
  inFlight = { key, promise };
  void promise.finally(() => { if (inFlight?.promise === promise) inFlight = null; }).catch(() => {});
  return promise;
}

async function collect(hosts: GpuHostConfig[]): Promise<GpuHealthResult> {
  const start = Date.now();
  const scripts = new Map<string, string>();
  for (const platform of new Set(hosts.map(host => host.platform))) {
    scripts.set(platform, await fs.readFile(path.join(process.cwd(), "scripts", `gpu-health-${platform}.${platform === "linux" ? "py" : "ps1"}`), "utf8"));
  }
  const results = new Array<GpuHostHealth>(hosts.length);
  let next = 0;
  // Large fleets still open at most four SSH processes at a time.
  await Promise.all(Array.from({ length: Math.min(4, hosts.length) }, async () => {
    while (next < hosts.length) {
      const index = next++;
      results[index] = await checkHost(hosts[index], scripts.get(hosts[index].platform)!);
    }
  }));
  return { hosts: results, checkedAt: Date.now(), durationMs: Date.now() - start };
}
