export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt: number;    // unix seconds
  windowSecs?: number; // window duration in seconds; omitted when unknown
};

// One entry in a usage source's recent-failure log. `at` is unix seconds of
// the most recent occurrence; consecutive identical failures collapse into a
// single entry with a bumped `count`.
export type UsageFailure = {
  message: string;
  at: number;
  count: number;
};

export type UsageResult =
  | { ok: true; windows: UsageWindow[]; snapshotAt?: number; staleReason?: string; failures?: UsageFailure[] }
  | { ok: false; error: string; failures?: UsageFailure[] };

export type EventItem = {
  title: string;
  start: number;      // unix seconds
  pinned: boolean;
  birthYear?: number; // set only for birthday events
};

export type EventsResult =
  | { ok: true; events: EventItem[] }
  | { ok: false; error: string };

export type ManualEventInput = {
  title: string;
  start: string;       // ISO 8601 ("2026-06-15T08:00:00Z") or date-only ("2026-09-12")
  pinned?: boolean;
};

export type BirthdayInput = {
  name: string;
  month: number;  // 1–12
  day: number;    // 1–31
  year?: number;  // birth year, enables age display
};

export type LifeConfig = {
  birthDate: string;       // ISO date ("1990-01-15")
  expectancyYears: number; // e.g. 80
};

export type AppConfig = {
  icsUrl: string | null;
  manualEvents: ManualEventInput[];
  birthdays: BirthdayInput[];
  pinnedEvents: string[];
  refreshSeconds: number;
  life: LifeConfig | null;
};
