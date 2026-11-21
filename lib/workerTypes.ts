// A worker earns either under a worker NFT or, for a Mac, under a wallet on one network.
export type WorkerIdentity =
  | { nftTokenId: string }
  | { address: string; network: "fast" | "relaxed" };

export type WorkerCheckConfig = { sshHost: string; label: string } & ({ container: string } | { process: string });

export type WorkerConfig = {
  id: string;
  label: string;
  group: string;
  // The Sogni account the earnings land in (several workers can share one).
  account: string;
  identity: WorkerIdentity;
  checks: WorkerCheckConfig[];
};

export type WorkersConfig = {
  historyUrl: string;
  poolUrl: string;
  workers: WorkerConfig[];
};

// One UTC day of a worker's records.
export type WorkerDay = {
  date: string;
  connectedHours: number;
  workingHours: number;
  jobsCompleted: number;
  jobsFailed: number;
  // Every completed job at list price.
  listUsd: number;
  // Pay-as-you-go jobs, credited in SOGNI at their list value when earned.
  directUsd: number;
  sogni: number;
  // Unlimited-plan work, paid from the monthly pool. Null when that month's pool is unknown.
  poolUnits: number;
  poolUsd: number | null;
};

export type PoolMonth = {
  month: string;
  workerPoolUsd: number;
  totalUnits: number;
  // False for the month in progress, whose rate assumes the pool accrues evenly by day.
  complete: boolean;
  finalized: boolean;
  usdPerUnit: number;
};

export type WorkerNetworkRow = {
  online: boolean;
  lastSeen: number | null;
  version: string | null;
  hardware: string | null;
  sharePct: number;
};

export type WorkerTotals = {
  listUsd: number;
  directUsd: number;
  poolUsd: number | null;
  sogni: number;
  jobsCompleted: number;
  jobsFailed: number;
  connectedHours: number;
  workingHours: number;
};

export type WorkerPeriods = {
  today: WorkerTotals;
  yesterday: WorkerTotals;
  month: WorkerTotals;
  lastMonth: WorkerTotals;
};

export type WorkerCheckResult = {
  label: string;
  state: "running" | "stopped" | "missing" | "unhealthy" | "unreachable";
  detail: string;
  startedAt: number | null;
  restarts: number | null;
};

export type WorkerIssue = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

export type WorkerStatus = "healthy" | "warning" | "critical";

export type WorkerReport = {
  id: string;
  label: string;
  group: string;
  account: string;
  identity: string;
  status: WorkerStatus;
  issues: WorkerIssue[];
  network: WorkerNetworkRow | null;
  checks: WorkerCheckResult[];
  days: WorkerDay[] | null;
  periods: WorkerPeriods | null;
};

export type WorkersResult = {
  checkedAt: number;
  durationMs: number;
  pools: PoolMonth[];
  errors: string[];
  workers: WorkerReport[];
};
