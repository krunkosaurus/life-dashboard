import type { WorkerCheckConfig, WorkerCheckResult } from "./workerTypes";

const INSPECT_FORMAT = '{"container":{{json .Name}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"startedAt":{{json .State.StartedAt}},"restarts":{{.RestartCount}}}';

// One read-only command per machine: a JSON line for each named container that exists
// and each named process that is running. Names are restricted to safe characters by
// the config parser, so they need no quoting here.
export function hostCheckCommand(checks: WorkerCheckConfig[]): string {
  const containers = checks.flatMap(check => "container" in check ? [check.container] : []);
  const parts = containers.length ? [`docker inspect --format '${INSPECT_FORMAT}' ${containers.join(" ")} 2>/dev/null`] : [];
  for (const check of checks) {
    if ("process" in check) parts.push(`pid=$(pgrep -x ${check.process} | head -n 1); [ -n "$pid" ] && printf '{"process":"${check.process}","etime":"%s"}\\n' "$(ps -o etime= -p "$pid" | tr -d ' ')"`);
  }
  return `${parts.join("; ")}; true`;
}

// ps prints elapsed time as [[days-]hours:]minutes:seconds.
function elapsedSeconds(etime: string): number {
  const [clock, days = "0"] = etime.split("-").reverse();
  const [seconds, minutes, hours = 0] = clock.split(":").reverse().map(Number);
  return Number(days) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export function parseHostChecks(stdout: string, checks: WorkerCheckConfig[], now: number): WorkerCheckResult[] {
  const containers = new Map<string, { status: string; health: string | null; startedAt: string; restarts: number }>();
  const processes = new Map<string, string>();
  // Some hosts print a login banner around the output; readings are the JSON lines.
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    const reading = JSON.parse(line);
    if (typeof reading.container === "string") containers.set(reading.container.replace(/^\//, ""), reading);
    else processes.set(reading.process, reading.etime);
  }
  return checks.map((check): WorkerCheckResult => {
    if ("container" in check) {
      const reading = containers.get(check.container);
      if (!reading) return { label: check.label, state: "missing", detail: "No container by this name exists on the machine.", startedAt: null, restarts: null };
      const running = reading.status === "running";
      return {
        label: check.label,
        state: !running ? "stopped" : reading.health === "unhealthy" ? "unhealthy" : "running",
        detail: !running ? `Docker reports it as ${reading.status}.` : reading.health ? `Running, health check ${reading.health}.` : "Running.",
        startedAt: Date.parse(reading.startedAt),
        restarts: reading.restarts,
      };
    }
    const etime = processes.get(check.process);
    if (!etime) return { label: check.label, state: "stopped", detail: "No process by this name is running.", startedAt: null, restarts: null };
    return { label: check.label, state: "running", detail: "Running.", startedAt: now - elapsedSeconds(etime) * 1000, restarts: null };
  });
}
