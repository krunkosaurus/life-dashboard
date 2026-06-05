# Life Dashboard — Design Spec

**Date:** 2026-05-27
**Status:** Approved (pending spec review)

## Purpose

A self-hosted, single-user web dashboard that surfaces personal stats and
metrics in one place. Version 1 focuses on three panels:

1. **Claude Code** live usage limits (5-hour and weekly windows).
2. **Codex** live usage limits (5-hour and weekly windows).
3. **Event countdowns** to calendar events imported from a private `.ics` URL.

The dashboard runs locally on the user's machine and is intended for that user
only. It is deliberately a focused MVP; an extensible widget framework is a
non-goal for v1.

## Decisions (from brainstorming)

- **Stack:** Next.js (App Router), run as a single process. React UI + server
  route handlers in one app, so secrets stay server-side.
- **Usage data:** Live "limit remaining" for both tools (not just historical).
- **Claude limits:** Fetched by reading the OAuth `accessToken` from
  `~/.claude/.credentials.json` and calling Anthropic's usage endpoint. Accepted
  caveats: the endpoint is undocumented (may change), and the app reads a
  sensitive token file.
- **Codex limits:** Read from the local `~/.codex/logs_2.sqlite` log database.
- **Calendar:** Imported from a user-provided private `.ics` URL (no OAuth).
- **Scope:** Focused MVP. No login, no history DB, no widget plugins, no cost
  estimates, no in-UI event editing.

## Architecture

A single Next.js App Router application, run with `npm run dev` (or
`next build && next start`). One process, one URL (`http://localhost:3000`),
bound to localhost only. React renders the UI; server-side route handlers
perform all privileged work (reading local files, calling the Anthropic
endpoint, fetching the `.ics`). Normalized data — never tokens — is sent to the
browser.

```
life-dashbaord/
  app/
    page.tsx                    # dashboard grid (client component shell)
    layout.tsx                  # root layout, global styles
    api/usage/claude/route.ts   # GET normalized Claude limits
    api/usage/codex/route.ts    # GET normalized Codex limits
    api/events/route.ts         # GET upcoming/pinned events
  lib/
    claude.ts    # read token, call usage endpoint, normalize
    codex.ts     # read latest codex.rate_limits from sqlite
    calendar.ts  # fetch + parse .ics, filter, sort
    config.ts    # load config.local.json / env
    types.ts     # shared normalized types
  components/
    Panel.tsx        # panel wrapper with title + states
    LimitGauge.tsx   # one usage window: % bar + reset countdown
    CountdownCard.tsx# one event countdown
  config.local.json  # gitignored: icsUrl, pinnedEvents, refreshSeconds
  config.example.json# committed template
```

## Data collectors

Each collector normalizes to a shared shape (`lib/types.ts`) so the UI treats
Claude and Codex identically.

### `lib/codex.ts`

- Open `~/.codex/logs_2.sqlite` **read-only** (account for WAL mode).
- Select the newest row whose `feedback_log_body` contains `codex.rate_limits`:
  `SELECT ts, feedback_log_body FROM logs WHERE feedback_log_body LIKE
  '%codex.rate_limits%' ORDER BY id DESC LIMIT 1`.
- Parse the JSON object embedded after `Received message ` in the row body.
- Extract `rate_limits.primary` (5-hour window) and `rate_limits.secondary`
  (weekly window): `used_percent` and `reset_at` (absolute unix seconds).
- Return the row's `ts` so the UI can display snapshot age — the data only
  updates when Codex actually runs, so it can be stale.

Observed payload shape (real sample):

```json
{
  "type": "codex.rate_limits",
  "plan_type": "pro",
  "rate_limits": {
    "allowed": true,
    "limit_reached": false,
    "primary":   { "used_percent": 7,  "window_minutes": 300,   "reset_at": 1779398785 },
    "secondary": { "used_percent": 29, "window_minutes": 10080, "reset_at": 1779820580 }
  }
}
```

### `lib/claude.ts`

- Read `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` (and
  `expiresAt` / `refreshToken` for staleness checks).
- Call Anthropic's OAuth usage endpoint with the bearer token. The exact URL
  and response shape are confirmed during implementation (the data Claude
  Code's `/usage` command displays).
- Normalize to the same per-window `{ used_percent, reset_at }` shape as Codex.
- The token is used only server-side, is never returned to the browser, and is
  never logged.

### `lib/calendar.ts`

- Fetch the user's private `.ics` URL server-side.
- Parse with `node-ical`.
- Return upcoming events (future `start`), sorted by soonest first.
- Events whose title matches an entry in `config.pinnedEvents` (case-insensitive
  substring) are flagged `pinned` and sorted to the top.

## Shared types (`lib/types.ts`)

```ts
type UsageWindow = { label: string; usedPercent: number; resetAt: number };
type UsageResult =
  | { ok: true; windows: UsageWindow[]; snapshotAt?: number }
  | { ok: false; error: string };

type EventItem = { title: string; start: number; pinned: boolean };
type EventsResult =
  | { ok: true; events: EventItem[] }
  | { ok: false; error: string };
```

## Data flow

1. The page (client component) loads and fetches `/api/usage/claude`,
   `/api/usage/codex`, and `/api/events` in parallel.
2. Cards render from the responses.
3. A client-side interval reticks every second so countdowns (time to limit
   reset, time to each event) stay live and smooth.
4. Underlying data re-fetches every `refreshSeconds` (default 60).
5. The browser receives only normalized numbers/strings — never the token.

## Configuration

`config.local.json` (gitignored), with a committed `config.example.json`:

```json
{
  "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics",
  "pinnedEvents": ["Birthday", "Flight"],
  "refreshSeconds": 60
}
```

`lib/config.ts` loads this file; environment variables may override individual
fields (e.g. `ICS_URL`).

## UI layout (MVP)

Responsive dark card grid:

- **Usage row:** two `Panel`s (Claude, Codex). Each contains two `LimitGauge`s —
  *5-hour* and *weekly* — each showing used %, a colored bar (green / amber /
  red thresholds), and "resets in HH:MM:SS". The Codex panel also shows snapshot
  age.
- **Countdowns row:** one `CountdownCard` per pinned/upcoming event, with a large
  live countdown (days / hrs / min / sec) and the event date.
- **Header:** title, manual refresh button, last-updated time.

Detailed visual polish (typography, spacing, motion) is handled during
implementation.

## Error handling

- Each API route returns `{ ok, data?, error? }`.
- Any single source failing renders that card in a friendly
  "unavailable — here's why" state rather than crashing the dashboard:
  - Claude: token missing / expired / endpoint error.
  - Codex: sqlite missing, or no `codex.rate_limits` rows yet.
  - Calendar: `icsUrl` unset, unreachable, or unparseable.
- The token is never logged. The server binds to localhost only.

## Testing

- Pure, testable parser functions: pass file contents / strings in, assert
  normalized output.
- Fixtures: the real `codex.rate_limits` JSON sample, a small `.ics` fixture,
  and a Claude usage-response fixture.
- Unit tests assert normalized output and error paths (missing fields, empty
  results).
- Manual verification: run the dev server and confirm all three panels show
  real data.

## Security notes

- Server binds to localhost only; no external exposure.
- `~/.claude/.credentials.json` is read server-side, read-only; the token is
  never returned to the client and never logged.
- `config.local.json` is gitignored (the `.ics` URL is a secret).

## Out of scope (YAGNI for v1)

- Authentication / multi-user.
- Historical/time-series database.
- Widget plugin framework.
- Cost estimates.
- Historical charts for Claude (live limits only in v1).
- In-UI event creation/editing.
