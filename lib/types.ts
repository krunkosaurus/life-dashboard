export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt: number;    // unix seconds
  windowSecs?: number; // window duration in seconds; omitted when unknown
};

export type UsageResult =
  | { ok: true; windows: UsageWindow[]; snapshotAt?: number }
  | { ok: false; error: string };

export type EventItem = {
  title: string;
  start: number;      // unix seconds
  pinned: boolean;
};

export type EventsResult =
  | { ok: true; events: EventItem[] }
  | { ok: false; error: string };

export type ManualEventInput = {
  title: string;
  start: string;       // ISO 8601 ("2026-06-15T08:00:00Z") or date-only ("2026-09-12")
  pinned?: boolean;
};

export type LifeConfig = {
  birthDate: string;       // ISO date ("1990-01-15")
  expectancyYears: number; // e.g. 80
};

export type AppConfig = {
  icsUrl: string | null;
  manualEvents: ManualEventInput[];
  pinnedEvents: string[];
  refreshSeconds: number;
  life: LifeConfig | null;
};
