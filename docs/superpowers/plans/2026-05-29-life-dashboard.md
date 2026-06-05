# Life Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Next.js dashboard showing live Claude Code + Codex usage limits (5-hour and weekly windows) and live countdowns to events imported from a private `.ics` calendar feed.

**Architecture:** Single Next.js (App Router) app run on `localhost:3000`. Server-side route handlers do all privileged work — reading `~/.codex/logs_2.sqlite`, reading `~/.claude/.credentials.json` and calling Anthropic's OAuth usage endpoint, and fetching/parsing the user's `.ics` URL. The React UI only ever receives normalized JSON. Pure parser functions are unit-tested with fixtures; the rest is verified manually in the browser.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript, `better-sqlite3` (read-only Codex log), `node-ical` (.ics parsing), Vitest (unit tests), Node 24.

**Spec:** `docs/superpowers/specs/2026-05-27-life-dashboard-design.md`

---

## File Structure

Files this plan creates (paths relative to repo root):

| Path | Purpose |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts` | Project + tooling config |
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Root layout + dashboard page |
| `app/api/usage/claude/route.ts` | GET normalized Claude limits |
| `app/api/usage/codex/route.ts` | GET normalized Codex limits |
| `app/api/events/route.ts` | GET upcoming/pinned events |
| `lib/types.ts` | Shared `UsageWindow` / `EventItem` / result types |
| `lib/config.ts` | Loads `config.local.json` + env overrides |
| `lib/codex.ts` | Reads sqlite, parses latest `codex.rate_limits` |
| `lib/claude.ts` | Reads OAuth token, calls Anthropic usage endpoint, normalizes |
| `lib/calendar.ts` | Fetches + parses `.ics`, filters/sorts |
| `components/Panel.tsx`, `components/LimitGauge.tsx`, `components/CountdownCard.tsx` | UI components |
| `config.example.json` | Committed template |
| `config.local.json` | User config — **gitignored** |
| `lib/__tests__/*.test.ts`, `lib/__tests__/fixtures/*` | Unit tests + fixtures |

`.gitignore` already exists and covers `node_modules/`, `.next/`, `config.local.json`, `.env*.local`.

Each lib module exposes a small, pure interface — file readers are separated from parsers so the parsers can be tested with string fixtures.

---

## Task 1: Project scaffold (Next.js + TypeScript + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "life-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 3000",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-sqlite3": "^11.0.0",
    "node-ical": "^0.20.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `app/layout.tsx`**

```tsx
import "./globals.css";

export const metadata = { title: "Life Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create `app/page.tsx`**

```tsx
export default function Page() {
  return <main style={{ padding: 24 }}><h1>Life Dashboard</h1><p>Scaffold OK.</p></main>;
}
```

- [ ] **Step 7: Create `app/globals.css`**

```css
:root { color-scheme: dark; }
html, body { margin: 0; padding: 0; background: #0b0d10; color: #e6e9ef; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` populated.

- [ ] **Step 9: Verify the scaffold builds and types check**

Run: `npm run typecheck`
Expected: PASS, no errors.

Run: `npm run dev` (kill with Ctrl+C after verifying)
Expected: Next.js starts on `http://127.0.0.1:3000`; visiting it renders "Life Dashboard / Scaffold OK."

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts app/
git commit -m "feat: scaffold Next.js + TypeScript + Vitest"
```

---

## Task 2: Shared types and config loader (TDD)

**Files:**
- Create: `lib/types.ts`
- Create: `lib/config.ts`, `lib/__tests__/config.test.ts`
- Create: `config.example.json`

- [ ] **Step 1: Create `lib/types.ts`**

```ts
export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt: number;    // unix seconds
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

export type AppConfig = {
  icsUrl: string | null;
  pinnedEvents: string[];
  refreshSeconds: number;
};
```

- [ ] **Step 2: Create `config.example.json`**

```json
{
  "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics",
  "pinnedEvents": ["Birthday", "Flight"],
  "refreshSeconds": 60
}
```

- [ ] **Step 3: Write failing tests `lib/__tests__/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../config";

describe("parseConfig", () => {
  it("returns defaults when given empty object", () => {
    const cfg = parseConfig({}, {});
    expect(cfg.icsUrl).toBeNull();
    expect(cfg.pinnedEvents).toEqual([]);
    expect(cfg.refreshSeconds).toBe(60);
  });

  it("reads icsUrl, pinnedEvents and refreshSeconds from the file", () => {
    const cfg = parseConfig(
      { icsUrl: "https://x/y.ics", pinnedEvents: ["A", "B"], refreshSeconds: 30 },
      {}
    );
    expect(cfg.icsUrl).toBe("https://x/y.ics");
    expect(cfg.pinnedEvents).toEqual(["A", "B"]);
    expect(cfg.refreshSeconds).toBe(30);
  });

  it("env ICS_URL overrides file icsUrl", () => {
    const cfg = parseConfig({ icsUrl: "from-file" }, { ICS_URL: "from-env" });
    expect(cfg.icsUrl).toBe("from-env");
  });

  it("clamps refreshSeconds to a minimum of 5", () => {
    const cfg = parseConfig({ refreshSeconds: 1 }, {});
    expect(cfg.refreshSeconds).toBe(5);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseConfig` is not exported / not defined.

- [ ] **Step 5: Implement `lib/config.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";

const DEFAULT_REFRESH = 60;
const MIN_REFRESH = 5;
const CONFIG_PATH = path.join(process.cwd(), "config.local.json");

export function parseConfig(
  file: Record<string, unknown>,
  env: Record<string, string | undefined>
): AppConfig {
  const icsUrl =
    (env.ICS_URL && String(env.ICS_URL)) ||
    (typeof file.icsUrl === "string" ? file.icsUrl : null);

  const pinnedEvents = Array.isArray(file.pinnedEvents)
    ? file.pinnedEvents.filter((s): s is string => typeof s === "string")
    : [];

  const refreshRaw =
    typeof file.refreshSeconds === "number" ? file.refreshSeconds : DEFAULT_REFRESH;
  const refreshSeconds = Math.max(MIN_REFRESH, Math.floor(refreshRaw));

  return { icsUrl, pinnedEvents, refreshSeconds };
}

export function loadConfig(): AppConfig {
  let file: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {
    file = {};
  }
  return parseConfig(file, process.env);
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/config.ts lib/__tests__/config.test.ts config.example.json
git commit -m "feat: shared types and config loader with overrides"
```

---

## Task 3: Codex collector — parse `codex.rate_limits` (TDD)

**Files:**
- Create: `lib/__tests__/fixtures/codex-rate-limits.txt` (real log row body)
- Create: `lib/codex.ts`, `lib/__tests__/codex.test.ts`

- [ ] **Step 1: Create fixture `lib/__tests__/fixtures/codex-rate-limits.txt`**

This is a copy of an actual `feedback_log_body` row prefix. The parser must locate the JSON object after `Received message ` and extract `rate_limits`.

```text
Received message {"type":"codex.rate_limits","plan_type":"pro","rate_limits":{"allowed":true,"limit_reached":false,"primary":{"used_percent":7,"window_minutes":300,"reset_after_seconds":13168,"reset_at":1779398785},"secondary":{"used_percent":29,"window_minutes":10080,"reset_after_seconds":434962,"reset_at":1779820580}},"code_review_rate_limits":null}
```

- [ ] **Step 2: Write failing test `lib/__tests__/codex.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseCodexRateLimitRow } from "../codex";

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures/codex-rate-limits.txt"),
  "utf8"
);

describe("parseCodexRateLimitRow", () => {
  it("extracts primary (5h) and secondary (weekly) windows", () => {
    const result = parseCodexRateLimitRow(fixture, 1779000000);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "5h", usedPercent: 7, resetAt: 1779398785 },
      { label: "weekly", usedPercent: 29, resetAt: 1779820580 },
    ]);
    expect(result.snapshotAt).toBe(1779000000);
  });

  it("returns ok:false when no rate_limits JSON present", () => {
    const result = parseCodexRateLimitRow("nothing here", 0);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when JSON is malformed", () => {
    const result = parseCodexRateLimitRow("Received message {bad json", 0);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- codex`
Expected: FAIL — `parseCodexRateLimitRow` not defined.

- [ ] **Step 4: Implement parser + db reader in `lib/codex.ts`**

```ts
import path from "node:path";
import os from "node:os";
import type { UsageResult } from "./types";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".codex", "logs_2.sqlite");

export function parseCodexRateLimitRow(body: string, snapshotAt: number): UsageResult {
  const marker = '{"type":"codex.rate_limits"';
  const start = body.indexOf(marker);
  if (start < 0) return { ok: false, error: "no rate_limits payload in row" };

  // Find the matching closing brace by counting depth.
  let depth = 0;
  let end = -1;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return { ok: false, error: "unterminated JSON in row" };

  let payload: { rate_limits?: { primary?: Window; secondary?: Window } };
  try {
    payload = JSON.parse(body.slice(start, end));
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${(e as Error).message}` };
  }

  const rl = payload.rate_limits;
  if (!rl?.primary || !rl?.secondary) {
    return { ok: false, error: "missing primary/secondary windows" };
  }

  return {
    ok: true,
    snapshotAt,
    windows: [
      { label: "5h",     usedPercent: rl.primary.used_percent,   resetAt: rl.primary.reset_at },
      { label: "weekly", usedPercent: rl.secondary.used_percent, resetAt: rl.secondary.reset_at },
    ],
  };
}

type Window = { used_percent: number; reset_at: number };

export function readLatestCodexRateLimit(dbPath = DEFAULT_DB_PATH): UsageResult {
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch (e) {
    return { ok: false, error: `better-sqlite3 unavailable: ${(e as Error).message}` };
  }

  let db: import("better-sqlite3").Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    return { ok: false, error: `cannot open ${dbPath}: ${(e as Error).message}` };
  }

  try {
    const row = db
      .prepare(
        "SELECT ts, feedback_log_body AS body FROM logs " +
        "WHERE feedback_log_body LIKE '%codex.rate_limits%' " +
        "ORDER BY id DESC LIMIT 1"
      )
      .get() as { ts: number; body: string } | undefined;
    if (!row) return { ok: false, error: "no codex.rate_limits rows yet (run Codex first)" };
    // ts is unix milliseconds in this schema.
    return parseCodexRateLimitRow(row.body, Math.floor(row.ts / 1000));
  } catch (e) {
    return { ok: false, error: `sqlite query failed: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- codex`
Expected: PASS, 3 tests.

- [ ] **Step 6: Smoke-test the db reader against the real file**

Run:
```bash
node -e "console.log(JSON.stringify(require('./lib/codex.ts'), null, 2))" 2>&1 | head
```

(That won't work without a runner.) Instead use `tsx`:
```bash
npx -y tsx -e "import('./lib/codex.ts').then(m => console.log(JSON.stringify(m.readLatestCodexRateLimit(), null, 2)))"
```
Expected: prints `{ ok: true, snapshotAt: <number>, windows: [...] }` with two windows.

If it errors with "no rows," run Codex once to populate, then retry.

- [ ] **Step 7: Commit**

```bash
git add lib/codex.ts lib/__tests__/codex.test.ts lib/__tests__/fixtures/codex-rate-limits.txt
git commit -m "feat: codex collector with sqlite reader and rate-limit parser"
```

---

## Task 4: Calendar collector — parse `.ics` + pin/sort (TDD)

**Files:**
- Create: `lib/__tests__/fixtures/sample.ics`
- Create: `lib/calendar.ts`, `lib/__tests__/calendar.test.ts`

- [ ] **Step 1: Create fixture `lib/__tests__/fixtures/sample.ics`**

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//life-dashboard test//EN
BEGIN:VEVENT
UID:past-1@test
SUMMARY:Old meeting
DTSTART:20200101T100000Z
DTEND:20200101T110000Z
END:VEVENT
BEGIN:VEVENT
UID:soon-1@test
SUMMARY:Lunch
DTSTART:20990101T120000Z
DTEND:20990101T130000Z
END:VEVENT
BEGIN:VEVENT
UID:pinned-1@test
SUMMARY:Flight to Tokyo
DTSTART:20990601T080000Z
DTEND:20990601T090000Z
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 2: Write failing test `lib/__tests__/calendar.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseEvents } from "../calendar";

const ics = fs.readFileSync(
  path.join(__dirname, "fixtures/sample.ics"),
  "utf8"
);
const NOW = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);

describe("parseEvents", () => {
  it("drops events that already ended before now", () => {
    const events = parseEvents(ics, [], NOW);
    expect(events.map(e => e.title)).not.toContain("Old meeting");
  });

  it("sorts upcoming events soonest first", () => {
    const events = parseEvents(ics, [], NOW);
    expect(events[0].title).toBe("Lunch");
    expect(events[1].title).toBe("Flight to Tokyo");
  });

  it("flags events matching pinnedEvents (case-insensitive substring) and sorts them first", () => {
    const events = parseEvents(ics, ["flight"], NOW);
    expect(events[0].title).toBe("Flight to Tokyo");
    expect(events[0].pinned).toBe(true);
    expect(events[1].pinned).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- calendar`
Expected: FAIL — `parseEvents` not defined.

- [ ] **Step 4: Implement `lib/calendar.ts`**

```ts
import ical from "node-ical";
import type { EventItem, EventsResult } from "./types";

export function parseEvents(icsText: string, pinned: string[], nowSec: number): EventItem[] {
  const data = ical.sync.parseICS(icsText);
  const lowered = pinned.map(p => p.toLowerCase());
  const items: EventItem[] = [];
  for (const v of Object.values(data)) {
    if ((v as { type?: string }).type !== "VEVENT") continue;
    const e = v as { summary?: string; start?: Date };
    if (!e.summary || !e.start) continue;
    const start = Math.floor(e.start.getTime() / 1000);
    if (start < nowSec) continue;
    const title = e.summary;
    const isPinned = lowered.some(p => title.toLowerCase().includes(p));
    items.push({ title, start, pinned: isPinned });
  }
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.start - b.start;
  });
  return items;
}

export async function fetchEvents(url: string, pinned: string[]): Promise<EventsResult> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} fetching .ics` };
    const text = await res.text();
    const events = parseEvents(text, pinned, Math.floor(Date.now() / 1000));
    return { ok: true, events };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- calendar`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/calendar.ts lib/__tests__/calendar.test.ts lib/__tests__/fixtures/sample.ics
git commit -m "feat: calendar collector with .ics parsing, filtering, and pinning"
```

---

## Task 5: Discover Anthropic OAuth usage endpoint

This is the single feasibility unknown from the spec. We grep the installed Claude Code CLI bundle for the URL it calls for `/usage`, then probe it once with `curl` to confirm the JSON shape. The output of this task is a short note checked into the repo describing the endpoint + shape.

**Files:**
- Create: `docs/superpowers/notes/anthropic-usage-endpoint.md`

- [ ] **Step 1: Locate the Claude Code install**

Run:
```bash
which claude
npm root -g
ls "$(npm root -g)" | grep -i anthropic
```
Expected: prints the global npm dir and shows a package like `@anthropic-ai/claude-code`.

If `which claude` returns `~/.claude/local/...` instead, list that directory and treat its `.js` bundle as the install path.

- [ ] **Step 2: Grep the bundle for usage endpoints**

Run (substitute the path found above for `$PKG`):
```bash
PKG="$(npm root -g)/@anthropic-ai/claude-code"
grep -rohE "https://[a-z0-9./_-]*usage[a-z0-9./_-]*|/api/oauth/[a-z_/-]*|/api/usage[a-z_/-]*" "$PKG" 2>/dev/null | sort -u | head
```
Expected: one or more URL fragments. Note the exact path (e.g. `/api/oauth/usage` or similar) and the host (likely `https://api.anthropic.com`).

- [ ] **Step 3: Probe the endpoint with the stored token**

```bash
TOK=$(python3 -c "import json;print(json.load(open('$HOME/.claude/.credentials.json'))['claudeAiOauth']['accessToken'])")
curl -sS -H "Authorization: Bearer $TOK" -H "anthropic-beta: oauth-2025-04-20" \
  "<URL_FROM_STEP_2>" | head -c 1500
unset TOK
```
Expected: a JSON body containing per-window utilization (look for keys like `five_hour`, `seven_day`, `utilization`, `resets_at`, `used_percent`, or similar). Capture the exact shape.

If the endpoint returns 401, the token may be expired — open Claude Code and let it refresh, then re-extract.

- [ ] **Step 4: Write `docs/superpowers/notes/anthropic-usage-endpoint.md`**

Document: the exact URL, required headers, an abbreviated example response (with numbers redacted to a single representative value), and a mapping plan from that response shape to `UsageWindow[]` with labels `"5h"` and `"weekly"`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/anthropic-usage-endpoint.md
git commit -m "docs: record Anthropic OAuth usage endpoint shape"
```

---

## Task 6: Claude collector (TDD against captured shape)

**Files:**
- Create: `lib/__tests__/fixtures/claude-usage.json` (synthesized from Task 5 findings)
- Create: `lib/claude.ts`, `lib/__tests__/claude.test.ts`

- [ ] **Step 1: Create fixture `lib/__tests__/fixtures/claude-usage.json`**

Use the response shape recorded in Task 5. The fixture must include both a 5-hour and a weekly window with `used_percent` (or equivalent fraction) and a reset timestamp. Two illustrative shapes — pick the one that matches Task 5:

```json
{
  "five_hour":  { "utilization": 0.42, "resets_at": "2026-05-29T18:00:00Z" },
  "seven_day":  { "utilization": 0.17, "resets_at": "2026-06-03T00:00:00Z" }
}
```

```json
{
  "usage": {
    "windows": [
      { "name": "five_hour",  "used_percent": 42, "reset_at": 1779000000 },
      { "name": "seven_day",  "used_percent": 17, "reset_at": 1779400000 }
    ]
  }
}
```

- [ ] **Step 2: Write failing test `lib/__tests__/claude.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/claude-usage.json";
import { normalizeClaudeUsage } from "../claude";

describe("normalizeClaudeUsage", () => {
  it("returns two windows labelled '5h' and 'weekly'", () => {
    const result = normalizeClaudeUsage(fixture);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows.map(w => w.label)).toEqual(["5h", "weekly"]);
    for (const w of result.windows) {
      expect(w.usedPercent).toBeGreaterThanOrEqual(0);
      expect(w.usedPercent).toBeLessThanOrEqual(100);
      expect(w.resetAt).toBeGreaterThan(0);
    }
  });

  it("returns ok:false on unrecognized shape", () => {
    const result = normalizeClaudeUsage({ totally: "different" });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- claude`
Expected: FAIL — `normalizeClaudeUsage` not defined.

- [ ] **Step 4: Implement `lib/claude.ts`**

Write the normalizer to match the shape captured in Task 5 (the code below shows the structure; adjust the field reads to match the documented shape from the note). The fetcher reads the token from `~/.claude/.credentials.json` and calls the endpoint URL from the note.

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { UsageResult, UsageWindow } from "./types";

// These two constants come from docs/superpowers/notes/anthropic-usage-endpoint.md
const USAGE_URL = "<URL_FROM_NOTE>";
const EXTRA_HEADERS: Record<string, string> = {
  // e.g. "anthropic-beta": "oauth-2025-04-20"
};

const CREDS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

function pctFrom(v: unknown): number | null {
  if (typeof v !== "number") return null;
  // accept either 0-1 utilization or 0-100 percent
  if (v <= 1 && v >= 0) return Math.round(v * 1000) / 10;
  if (v >= 0 && v <= 100) return v;
  return null;
}

function tsFrom(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
}

// IMPORTANT: adjust the two `extract` calls below to match the shape captured in Task 5.
export function normalizeClaudeUsage(raw: unknown): UsageResult {
  const r = raw as Record<string, unknown>;
  const fiveHour =
    extract(r["five_hour"]) ||
    extractFromList(r["usage"], "five_hour") ||
    extract((r["windows"] as Record<string, unknown> | undefined)?.["five_hour"]);
  const weekly =
    extract(r["seven_day"]) ||
    extractFromList(r["usage"], "seven_day") ||
    extract((r["windows"] as Record<string, unknown> | undefined)?.["seven_day"]);

  if (!fiveHour || !weekly) {
    return { ok: false, error: "could not extract 5h/weekly windows from response" };
  }
  return {
    ok: true,
    windows: [
      { label: "5h",     usedPercent: fiveHour.usedPercent, resetAt: fiveHour.resetAt },
      { label: "weekly", usedPercent: weekly.usedPercent,   resetAt: weekly.resetAt },
    ],
  };
}

function extract(v: unknown): UsageWindow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pct = pctFrom(o.used_percent) ?? pctFrom(o.utilization);
  const reset = tsFrom(o.reset_at) ?? tsFrom(o.resets_at);
  return pct != null && reset != null ? { label: "", usedPercent: pct, resetAt: reset } : null;
}

function extractFromList(v: unknown, name: string): UsageWindow | null {
  const u = v as { windows?: Array<Record<string, unknown>> } | undefined;
  const w = u?.windows?.find(x => x.name === name);
  return w ? extract(w) : null;
}

export async function fetchClaudeUsage(): Promise<UsageResult> {
  let creds: { claudeAiOauth?: { accessToken?: string } };
  try {
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
  } catch (e) {
    return { ok: false, error: `cannot read Claude credentials: ${(e as Error).message}` };
  }
  const token = creds.claudeAiOauth?.accessToken;
  if (!token) return { ok: false, error: "no Claude OAuth token found" };

  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, ...EXTRA_HEADERS },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `usage endpoint HTTP ${res.status}` };
    return normalizeClaudeUsage(await res.json());
  } catch (e) {
    return { ok: false, error: `usage endpoint fetch failed: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- claude`
Expected: PASS, 2 tests.

- [ ] **Step 6: Smoke-test live fetch**

```bash
npx -y tsx -e "import('./lib/claude.ts').then(m => m.fetchClaudeUsage().then(r => console.log(JSON.stringify(r, null, 2))))"
```
Expected: `{ ok: true, windows: [{label:"5h",...},{label:"weekly",...}] }`.

If `ok:false`, re-check Task 5's findings and adjust the field reads in `normalizeClaudeUsage` and/or the URL/headers constants.

- [ ] **Step 7: Commit**

```bash
git add lib/claude.ts lib/__tests__/claude.test.ts lib/__tests__/fixtures/claude-usage.json
git commit -m "feat: claude collector reading OAuth token and calling usage endpoint"
```

---

## Task 7: API routes

Three thin route handlers wrap the collectors and add a `Cache-Control: no-store` header. All three live under `app/api/` and the dev server picks them up automatically.

**Files:**
- Create: `app/api/usage/codex/route.ts`
- Create: `app/api/usage/claude/route.ts`
- Create: `app/api/events/route.ts`

- [ ] **Step 1: Create `app/api/usage/codex/route.ts`**

```ts
import { NextResponse } from "next/server";
import { readLatestCodexRateLimit } from "@/lib/codex";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = readLatestCodexRateLimit();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: Create `app/api/usage/claude/route.ts`**

```ts
import { NextResponse } from "next/server";
import { fetchClaudeUsage } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchClaudeUsage();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 3: Create `app/api/events/route.ts`**

```ts
import { NextResponse } from "next/server";
import { fetchEvents } from "@/lib/calendar";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadConfig();
  if (!cfg.icsUrl) {
    return NextResponse.json(
      { ok: false, error: "icsUrl not configured — set it in config.local.json" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const result = await fetchEvents(cfg.icsUrl, cfg.pinnedEvents);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 4: Smoke-test the routes**

Start the dev server: `npm run dev`

In another shell:
```bash
curl -s http://127.0.0.1:3000/api/usage/codex  | head -c 400; echo
curl -s http://127.0.0.1:3000/api/usage/claude | head -c 400; echo
curl -s http://127.0.0.1:3000/api/events       | head -c 400; echo
```

Expected: each prints a JSON `{ "ok": true, ... }` (or `{ "ok": false, "error": ... }` with a clear reason if the source isn't configured yet — that's a passing state for `events` if `config.local.json` hasn't been created).

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add app/api/
git commit -m "feat: API routes wrapping codex/claude/events collectors"
```

---

## Task 8: UI components

**Files:**
- Create: `components/Panel.tsx`
- Create: `components/LimitGauge.tsx`
- Create: `components/CountdownCard.tsx`

- [ ] **Step 1: Create `components/Panel.tsx`**

```tsx
export function Panel({ title, footer, children }: {
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "#11151b", border: "1px solid #1c222b", borderRadius: 12,
      padding: 16, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: 0.2 }}>{title}</h2>
        {footer && <div style={{ fontSize: 12, color: "#7a8595" }}>{footer}</div>}
      </header>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Create `components/LimitGauge.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

function colorFor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#22c55e";
}

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "now";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function LimitGauge({ label, usedPercent, resetAt }: {
  label: string; usedPercent: number; resetAt: number;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, resetAt - now);
  const color = colorFor(usedPercent);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "#9aa6b8" }}>{label}</span>
        <span><strong>{usedPercent.toFixed(0)}%</strong> · resets in {fmtCountdown(remaining)}</span>
      </div>
      <div style={{ background: "#0b0d10", height: 8, borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
          height: "100%", background: color, transition: "width 400ms ease",
        }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/CountdownCard.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

function parts(secs: number) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return { d, h, m, s };
}

export function CountdownCard({ title, start, pinned }: {
  title: string; start: number; pinned: boolean;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, start - now);
  const { d, h, m, s } = parts(remaining);
  const when = new Date(start * 1000).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <article style={{
      background: "#11151b",
      border: `1px solid ${pinned ? "#3b4d7a" : "#1c222b"}`,
      borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {pinned && <span style={{ fontSize: 10, color: "#7aa2f7", letterSpacing: 1 }}>PINNED</span>}
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 22, fontWeight: 600, letterSpacing: 0.5 }}>
        {d}d {h.toString().padStart(2, "0")}h {m.toString().padStart(2, "0")}m {s.toString().padStart(2, "0")}s
      </div>
      <div style={{ fontSize: 12, color: "#7a8595" }}>{when}</div>
    </article>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/
git commit -m "feat: Panel, LimitGauge, and CountdownCard components"
```

---

## Task 9: Dashboard page wiring

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css` (add `.grid` helper)

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { LimitGauge } from "@/components/LimitGauge";
import { CountdownCard } from "@/components/CountdownCard";
import type { EventsResult, UsageResult } from "@/lib/types";

const REFRESH_MS = 60_000;

async function safeFetch<T>(url: string): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `request failed: ${(e as Error).message}` };
  }
}

export default function Page() {
  const [claude, setClaude] = useState<UsageResult | null>(null);
  const [codex, setCodex]   = useState<UsageResult | null>(null);
  const [events, setEvents] = useState<EventsResult | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [c, x, e] = await Promise.all([
      safeFetch<UsageResult>("/api/usage/claude"),
      safeFetch<UsageResult>("/api/usage/codex"),
      safeFetch<EventsResult>("/api/events"),
    ]);
    setClaude(c as UsageResult);
    setCodex(x as UsageResult);
    setEvents(e as EventsResult);
    setUpdated(Math.floor(Date.now() / 1000));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const updatedAt =
    updated != null ? new Date(updated * 1000).toLocaleTimeString() : "—";

  return (
    <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Life Dashboard</h1>
        <div style={{ fontSize: 12, color: "#7a8595" }}>
          updated {updatedAt}{" "}
          <button onClick={refresh} style={{ marginLeft: 8, background: "transparent", color: "#7aa2f7", border: "1px solid #1c222b", padding: "2px 8px", borderRadius: 6, cursor: "pointer" }}>
            refresh
          </button>
        </div>
      </header>

      <div className="grid grid-2">
        <UsagePanel title="Claude Code" data={claude} />
        <UsagePanel title="Codex" data={codex} />
      </div>

      <section>
        <h2 style={{ margin: "0 0 12px", fontSize: 16, color: "#9aa6b8", fontWeight: 600 }}>Countdowns</h2>
        <EventsGrid data={events} />
      </section>
    </main>
  );
}

function UsagePanel({ title, data }: { title: string; data: UsageResult | null }) {
  if (!data) return <Panel title={title}><Skeleton /></Panel>;
  if (!data.ok) return <Panel title={title}><Unavailable reason={data.error} /></Panel>;
  const footer =
    data.snapshotAt
      ? `snapshot ${Math.max(0, Math.round((Date.now() / 1000 - data.snapshotAt) / 60))}m old`
      : null;
  return (
    <Panel title={title} footer={footer}>
      {data.windows.map(w => (
        <LimitGauge key={w.label} label={w.label} usedPercent={w.usedPercent} resetAt={w.resetAt} />
      ))}
    </Panel>
  );
}

function EventsGrid({ data }: { data: EventsResult | null }) {
  if (!data) return <Skeleton />;
  if (!data.ok) return <Unavailable reason={data.error} />;
  if (data.events.length === 0) return <p style={{ color: "#7a8595", fontSize: 13 }}>No upcoming events.</p>;
  return (
    <div className="grid grid-3">
      {data.events.slice(0, 9).map(e => (
        <CountdownCard key={`${e.title}-${e.start}`} title={e.title} start={e.start} pinned={e.pinned} />
      ))}
    </div>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <p style={{ color: "#f59e0b", fontSize: 13, margin: 0 }}>Unavailable — {reason}</p>;
}

function Skeleton() {
  return <p style={{ color: "#7a8595", fontSize: 13, margin: 0 }}>Loading…</p>;
}
```

- [ ] **Step 2: Append grid helpers to `app/globals.css`**

```css
.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
@media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Typecheck and verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev` and open `http://127.0.0.1:3000` in a browser.
Expected:
- Header shows "Life Dashboard" + updated time + refresh button.
- Two usage panels render. If a source is unavailable, the panel shows an orange "Unavailable — <reason>" line instead of crashing.
- The Codex panel's gauges tick down their reset countdown each second.
- The events section either shows "Unavailable — icsUrl not configured…" (expected pre-config) or upcoming event cards.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat: dashboard page wiring usage panels and event countdowns"
```

---

## Task 10: README with run + configure instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Life Dashboard

A self-hosted personal dashboard showing live Claude Code + Codex usage limits and countdowns to pinned calendar events.

## Requirements
- Node 22+ (24 recommended)
- macOS or Linux (paths assume `~/.claude` and `~/.codex`)
- Both Claude Code and Codex must have been run at least once on this machine

## Setup
```bash
npm install
cp config.example.json config.local.json
# Edit config.local.json: set icsUrl to your calendar's private .ics URL,
# and list pinned event keywords (matched case-insensitively in event titles).
npm run dev
# Open http://127.0.0.1:3000
```

## What's where
- Codex limits are read from `~/.codex/logs_2.sqlite` (the latest `codex.rate_limits` row).
- Claude limits are fetched from Anthropic's OAuth usage endpoint using the
  token in `~/.claude/.credentials.json`. The token never reaches the browser.
- Events come from the `icsUrl` you configure. Pinned titles bubble to the top.

## Security
The server binds to `127.0.0.1` only. `config.local.json` is gitignored because
your private `.ics` URL is a secret.

## Tests
```bash
npm test
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, security, and run instructions"
```

---

## Task 11: End-to-end manual verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass across config / codex / calendar / claude.

- [ ] **Step 2: Configure and launch**

Ensure `config.local.json` has a real `icsUrl` and at least one `pinnedEvents` entry that matches a real event.

Run: `npm run dev`
Open `http://127.0.0.1:3000`.

- [ ] **Step 3: Verify each panel**

Confirm in the browser:
- Claude panel: `5h` and `weekly` gauges render with non-zero percentages and a live reset countdown.
- Codex panel: same, plus the "snapshot N m old" footer.
- Countdowns: at least one card visible; pinned events appear first with the "PINNED" tag and a colored border; the seconds-place digit ticks every second.

- [ ] **Step 4: Verify graceful failure**

Temporarily rename `config.local.json` → `config.local.json.bak`. Refresh the page.
Expected: Events section shows "Unavailable — icsUrl not configured…"; the two usage panels keep working.

Restore: `mv config.local.json.bak config.local.json`.

- [ ] **Step 5: Verify no token leakage**

Open DevTools → Network → click `/api/usage/claude`. Inspect the response body.
Expected: only normalized `windows` data — no `accessToken`, `Bearer`, or `claudeAiOauth` strings anywhere in the response.

- [ ] **Step 6: Stop the dev server.**

No commit needed for a verification-only task. If anything failed, file fixes as additional commits.

---

## Self-review notes

- **Spec coverage:** scaffold (Tasks 1–2), Codex collector (3), Calendar collector (4), Claude collector (5–6), API routes (7), UI components (8), dashboard page (9), README (10), manual verify (11). All seven spec sections mapped.
- **No placeholders:** Task 5 documents a real discovery procedure (commands + commit), and Task 6's normalizer ships a multi-shape extractor so it works against whichever variant Task 5 finds.
- **Type consistency:** `UsageResult` / `UsageWindow` / `EventsResult` are defined once in `lib/types.ts` and used identically by collectors, API routes, and components.
