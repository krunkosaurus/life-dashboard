# Life Dashboard

A self-hosted personal dashboard. At a glance it shows:

- **Life & year progress** — what fraction of your life expectancy you've lived
  (age, years remaining) plus a 12-month strip for the current year, color-coded
  by month, with the live month filling in real time.
- **AI usage limits** — live Claude Code and Codex rate-limit gauges (5h + weekly
  windows) with reset countdowns.
- **Servers** — online/offline status of your Tailscale machines.
- **Countdowns & Anniversaries** — upcoming calendar events and recurring
  birthdays, split into two panels.

Everything reads from a single `config.local.json`. Sections you don't configure
are simply omitted.

![Life Dashboard screenshot](docs/images/life-dashboard-demo.png)

## Requirements
- Node 22+ (24 recommended)
- macOS or Linux (paths assume `~/.claude` and `~/.codex`)
- Both Claude Code and Codex must have been run at least once on this machine
  (for the usage gauges)
- The Tailscale CLI on this host, and this host joined to your tailnet, for the
  Servers panel (optional — leave `tailscaleHosts` empty to hide it)

## Setup
```bash
npm install
cp config.example.json config.local.json
# Edit config.local.json — see "Configuration" below.
npm run dev
# Open http://127.0.0.1:3000
```

To run on a different port, set `PORT`:
```bash
PORT=3100 npm run dev
```

For production, build once and serve:
```bash
npm run build
npm start            # next start -H 127.0.0.1 (honors PORT)
```

## Configuration

All settings live in `config.local.json` (gitignored). `config.example.json` is a
complete, working template. Every key is optional; omit a section to hide its
panel.

```json
{
  "icsUrl": null,
  "manualEvents": [
    { "title": "Flight to Tokyo", "start": "2026-06-15T08:00:00Z", "pinned": true },
    { "title": "Product launch",  "start": "2026-07-01T17:00:00-05:00" },
    { "title": "Tax deadline",    "start": "2027-04-15" }
  ],
  "birthdays": [
    { "name": "Ada",   "month": 12, "day": 10, "year": 1815 },
    { "name": "Grace", "month": 12, "day": 9 }
  ],
  "pinnedEvents": ["Flight"],
  "refreshSeconds": 60,
  "life": { "birthDate": "1990-01-15", "expectancyYears": 80 },
  "tailscaleHosts": [
    { "host": "blackpi", "alias": "Cold plunge" },
    { "host": "winton.tail87750.ts.net", "alias": "Office box" },
    { "host": "100.126.38.102", "alias": "By IP" }
  ]
}
```

### Events (Countdowns & Anniversaries)

Events come from two sources, merged together (duplicates removed, pinned events
bubble to the top):

- **`manualEvents`** — a JSON array you maintain by hand. `start` accepts any
  string `Date.parse` understands: ISO 8601 (`"2026-06-15T08:00:00Z"`), a
  date-only string (`"2026-09-12"`, treated as midnight UTC), or a verbose form
  like `"Jul 1 2026 17:00:00 GMT+0800"`. `pinned: true` sorts an event to the top.
  Past events are dropped automatically.
- **`icsUrl`** — a private `.ics` URL (e.g. Google Calendar's "Secret address in
  iCal format"). Set to `null` to disable. Note: Google Workspace organizational
  calendars only expose a *public* iCal URL, not a secret one — manual entries are
  usually the right answer for work-managed accounts. Can also be supplied via the
  `ICS_URL` environment variable, which overrides the file value.

**`pinnedEvents`** is a list of keywords; any event (from either source) whose
title contains one of them (case-insensitive substring) is pinned.

Events are split into two panels on the dashboard:

- **Countdowns** — everything else.
- **Anniversaries** — birthdays (see below) and any event whose title contains
  "birthday" or "anniversary".

Both panels are collapsible.

### Birthdays

**`birthdays`** are recurring annual events, rendered in the Anniversaries panel:

- `name`, `month` (1–12), `day` (1–31) are required; `year` (birth year) is
  optional and, when present, shows the upcoming age.
- Each birthday automatically rolls to its next occurrence, so it's always a
  countdown to the next one.

### Life progress

**`life`** powers the progress bars at the top:

- `birthDate` — ISO date (`"1990-01-15"`).
- `expectancyYears` — used to compute the "% of life complete" bar (age and
  estimated years remaining).
- The year strip below it is purely calendar-driven (month + year percentages),
  independent of `life`.

Omit `life` to hide the top bars.

### Servers (Tailscale)

**`tailscaleHosts`** lists machines to monitor. Each is `{ "host": ..., "alias"?: ... }`
where `host` is a bare hostname (`"blackpi"`), an FQDN
(`"winton.tail87750.ts.net"`), or a Tailscale IP (`"100.126.38.102"`); `alias` is
the display name and falls back to `host`.

Status is read from `tailscale status --json`, which reflects the **control
plane's** view of each peer — so it works even when this host can't directly
route to the machine. The Servers panel collapses automatically when everything
is online and auto-expands the moment a server goes down.

### Refresh

**`refreshSeconds`** controls the dashboard's polling interval (default 60,
minimum 5).

## How the data is fetched
- **Codex limits** are fetched live by spawning `codex app-server` and calling its
  `account/rateLimits/read` JSON-RPC method — the same call the Codex TUI makes
  for `/status`. (Older versions persisted a `codex.rate_limits` row to
  `~/.codex/logs_2.sqlite`, but Codex >= 0.135 stopped writing it.) Requires the
  `codex` binary on PATH; if the call fails the panel shows the error.
- **Claude limits** are fetched from Anthropic's OAuth usage endpoint. On macOS the
  token is read from the login Keychain (service `Claude Code-credentials`, which
  the Claude Code CLI keeps current), falling back to `~/.claude/.credentials.json`
  on Linux or if the Keychain item is absent; whichever is freshest wins. The token
  never reaches the browser, and is auto-refreshed when expired (backing off on
  `Retry-After` when rate limited). Recent fetch failures are logged per source in
  a collapsible list under each gauge.
- **Servers** come from the local `tailscale` CLI (see above), cached briefly.
- **Events** come from `manualEvents`, `birthdays`, and/or `icsUrl`, all merged.

## Security
The server binds to `127.0.0.1` only. `config.local.json` is gitignored because
your private `.ics` URL is a secret, and OAuth tokens never leave the server.

## Tests
```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```
