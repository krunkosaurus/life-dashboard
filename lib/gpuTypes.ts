export type GpuHostConfig = {
  id: string;
  label: string;
  group: string;
  sshHost: string;
  platform: "linux" | "windows";
  jumpHost?: string;
};

export type GpuDevice = {
  name: string;
  utilization: number | null;
  temperatureC: number | null;
  thermalHeadroomC: number | null;
  thermalSlowdown: boolean | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  fanPercent: number | null;
  uncorrectedErrors: number | null;
};

export type GpuProbe = {
  schema: 1;
  os: string;
  uptimeSeconds: number;
  cpu: { name: string; cores: number; utilization: number | null; temperatureC: number | null; load1: number | null };
  memory: { totalMiB: number; availableMiB: number; swapUsedMiB: number | null };
  disks: { mount: string; totalGiB: number; freeGiB: number }[];
  driver: string | null;
  cuda: string | null;
  gpus: GpuDevice[];
  updates: { pending: number | null; security: number | null; checkedAt: number | null; rebootRequired: boolean | null; source: string };
  services: { name: string; state: string }[];
  events: { at: number; message: string }[];
  limitations: string[];
};

export type GpuIssue = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

export type GpuHostHealth = {
  id: string;
  label: string;
  group: string;
  status: "healthy" | "warning" | "critical" | "unreachable" | "unknown";
  checkedAt: number;
  durationMs: number;
  issues: GpuIssue[];
  snapshot: GpuProbe | null;
};

export type GpuHealthResult = {
  hosts: GpuHostHealth[];
  checkedAt: number;
  durationMs: number;
};
