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
# Edit config.local.json — see "Configuring events" below.
npm run dev
# Open http://127.0.0.1:3000
```

To run on a different port, set `PORT`:
```bash
PORT=3100 npm run dev
```

## Configuring events

The Countdowns panel reads from two sources, in any combination:

- **`manualEvents`** — a JSON array you maintain by hand. `start` is ISO 8601
  (e.g. `"2026-06-15T08:00:00Z"`) or a date-only string (`"2026-09-12"`,
  treated as midnight UTC). `pinned: true` makes an event sort to the top.
- **`icsUrl`** — a private `.ics` URL (e.g. Google Calendar's "Secret address
  in iCal format"). Set to `null` to disable. Note: Google Workspace
  organizational calendars only expose a *public* iCal URL, not a secret one
  — manual entries are usually the right answer for work-managed accounts.

`pinnedEvents` is a list of keywords; any event (from either source) whose
title contains one of them (case-insensitive substring) is pinned.

```json
{
  "icsUrl": null,
  "manualEvents": [
    { "title": "Flight to Tokyo", "start": "2026-06-15T08:00:00Z", "pinned": true },
    { "title": "Birthday",        "start": "2026-09-12" }
  ],
  "pinnedEvents": ["Flight"],
  "refreshSeconds": 60
}
```

## What's where
- Codex limits are fetched live by spawning `codex app-server` and calling its
  `account/rateLimits/read` JSON-RPC method — the same call the Codex TUI makes
  for `/status`. (Older versions persisted a `codex.rate_limits` row to
  `~/.codex/logs_2.sqlite`, but Codex >= 0.135 stopped writing it.) Requires the
  `codex` binary on PATH; if the call fails the panel shows the error.
- Claude limits are fetched from Anthropic's OAuth usage endpoint. On macOS the
  token is read from the login Keychain (service `Claude Code-credentials`,
  where the Claude Code CLI keeps it current), falling back to
  `~/.claude/.credentials.json` on Linux or if the Keychain item is absent;
  whichever is freshest wins. The token never reaches the browser, and is
  auto-refreshed when expired (backing off on `Retry-After` when rate limited).
- Events come from `manualEvents` and/or `icsUrl`. Both sources are merged,
  duplicates removed, pinned events bubble to the top.

## Security
The server binds to `127.0.0.1` only. `config.local.json` is gitignored because
your private `.ics` URL is a secret.

## Tests
```bash
npm test
```
