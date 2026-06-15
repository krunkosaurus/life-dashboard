# Life Dashboard

A self-hosted personal dashboard. At a glance it shows:

- **Life & year progress** — what fraction of your life expectancy you've lived
  (age, years remaining) plus a 12-month strip for the current year, color-coded
  by month, with the live month filling in real time.
- **AI usage limits** — live Claude Code and Codex rate-limit gauges (5h + weekly
  windows) with reset countdowns.
- **Analytics** — grouped bar charts of recent daily metrics per location (e.g.
  batches/photos generated and prints requested/completed), driven entirely by
  numbers you keep in config.
- **Servers** — online/offline status of your Tailscale machines.
- **Countdowns & Anniversaries** — upcoming calendar events and recurring
  birthdays/anniversaries, split into two panels (Countdowns ordered
  soonest-first; Anniversaries ordered by upcoming year milestone).

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
    { "name": "Grace", "month": 12, "day": 9 },
    { "name": "Ada & Charles", "type": "anniversary", "label": "Wedding", "month": 7, "day": 8, "year": 1835 }
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

- **Countdowns** — everything else. Ordered soonest-ending first.
- **Anniversaries** — `birthdays`/anniversaries (see below) and any event whose
  title contains "birthday" or "anniversary". Ordered by upcoming year milestone
  (turning 4, turning 44, …), smallest first; entries without an origin `year`
  have no milestone and fall to the end by calendar date.

Pinned events are kept on top in both panels, and both are collapsible.

### Birthdays & anniversaries

**`birthdays`** are recurring annual events, rendered in the Anniversaries panel:

- `name`, `month` (1–12), `day` (1–31) are required. Each entry automatically
  rolls to its next occurrence, so it's always a countdown to the next one.
- `type` is `"birthday"` (default) or `"anniversary"`. Birthdays title as
  *"<name>'s Birthday"* and show a `BDAY` badge; anniversaries title as the
  `name` and show an `ANNIV` badge — so not everything is assumed to be a birthday.
- `label` (optional) overrides the title outright, e.g. `"Wedding"`.
- `year` (optional) is the origin year — birth year, wedding year, etc. When
  present the card shows the upcoming count of years elapsed (the age, for a
  birthday); when omitted it shows just the countdown and date.

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

### Analytics (charts)

**`analytics`** powers the charts panel. It's fully config-driven — the dashboard
renders whatever daily datapoints you put here, so the grouping and labels are
yours to define:

```json
"analytics": {
  "title": "Analytics",
  "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "locations": [
    {
      "name": "Site A",
      "url": "https://site-a.example.com/admin/analytics",
      "charts": [
        { "title": "Generation", "series": [
          { "label": "Batches", "values": [40, 52, 38, 61, 75, 58, 49] },
          { "label": "Photos",  "values": [320, 410, 300, 520, 640, 470, 390] }
        ]},
        { "title": "Prints", "series": [
          { "label": "Requested", "values": [18, 24, 15, 29, 33, 21, 19] },
          { "label": "Completed", "values": [17, 22, 15, 27, 31, 20, 18] }
        ]}
      ]
    }
  ]
}
```

- `title` — panel heading (defaults to `"Analytics"`).
- `days` — x-axis labels, one per data point (e.g. the last 7 days).
- `locations` — each is `{ name, url?, charts }`. `url` (optional) adds a "source"
  link. Each location renders its charts side by side.
- `charts` — each is `{ title, series }`. Every chart draws its series as grouped
  bars across the days, with a per-series total in the legend. Two series per chart
  (a natural pair) reads best, but any number works.

Each **series** is one of two modes:

- **Static** — `{ label, values }`, where `values` is one number per `day`. Good
  for hand-maintained snapshots; this is what `config.example.json` ships.
- **Live** — `{ label, field }`, used together with a location-level `source`. The
  dashboard fetches the data on each refresh and reads `field` from each daily row.

To pull live data, add a `source` to the location and switch its series to `field`:

```json
{
  "name": "Site A",
  "url": "https://site-a.example.com/admin/analytics",
  "source": {
    "api": "https://api.example.com/analytics/historical",
    "origin": "https://site-a.example.com",
    "params": { "days": 7 }
  },
  "charts": [
    { "title": "Generation", "series": [
      { "label": "Batches", "field": "batches" },
      { "label": "Photos",  "field": "photos" }
    ]},
    { "title": "Prints", "series": [
      { "label": "Requested", "field": "requested" },
      { "label": "Completed", "field": "completed" }
    ]}
  ]
}
```

The `source` describes any JSON HTTP endpoint that returns one row per day
(either a top-level array or `{ "data": [ … ] }`):

- `source.api` (required) — the endpoint URL.
- `source.origin` (optional) — sent as the request's `Origin`/`Referer` header.
  Use it for APIs that return different data per calling origin.
- `source.params` (optional) — query params appended to the URL, e.g.
  `{ "days": 7 }`.
- `source.dateField` (optional) — the row property holding the day; defaults to
  `"date"`.
- Series then use `field` (the row property to read each day) instead of
  `values`; the day labels come from each row's date field. Results are cached
  briefly server-side. If a location's fetch fails, that location shows an
  "Unavailable" message while the others keep rendering.

Malformed entries are dropped defensively, and non-numeric values become `0`.
Omit `analytics` entirely to hide the panel.

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
