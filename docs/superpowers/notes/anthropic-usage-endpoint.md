# Anthropic OAuth Usage Endpoint

Research notes for the live-usage collector consumed by Task 6.

Source of truth: the minified Claude Code bundle at
`/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js` (version
`2.1.33`, build 2026-02-06). All shape details below were extracted from
that bundle; field names are the exact strings Claude Code reads off the
JSON response. A live probe was attempted but blocked — see "Probe status"
at the end.

## Endpoint

```
GET https://api.anthropic.com/api/oauth/usage
```

The bundle composes the URL as `${BASE_API_URL}/api/oauth/usage` where
`BASE_API_URL` is `https://api.anthropic.com` in production.

## Required headers

| Header            | Value                                  | Notes |
|-------------------|----------------------------------------|-------|
| `Authorization`   | `Bearer <accessToken>`                 | OAuth access token from `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) or the macOS Keychain item `Claude Code-credentials` (account: macOS username). |
| `anthropic-beta`  | `oauth-2025-04-20`                     | Required — the bundle hard-codes this constant for every OAuth request. |
| `Content-Type`    | `application/json`                     | Sent by the CLI even for GET. |
| `User-Agent`      | `claude-code/<version>` (e.g. `claude-code/2.1.33`) | Sent via `XH()` in the bundle. Any reasonable UA is likely fine but match the CLI to stay under the radar. |

Auth fallback: if no OAuth token is present, the CLI substitutes
`x-api-key: <ANTHROPIC_API_KEY>` instead of `Authorization` — but this
endpoint is the OAuth-account usage endpoint, so API-key auth is not
expected to return per-window usage. Use the OAuth token.

The CLI uses a 5000ms request timeout; the collector should use the same
order of magnitude.

## Token expiry

Each credential record carries `expiresAt` (ms-since-epoch). The bundle
treats the token as expired with a small skew; if expired, the CLI
refreshes via:

```
POST https://platform.claude.com/v1/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<refreshToken>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers"
}
```

Response includes a new `access_token`, `refresh_token`, and `expires_in`.
Task 6's collector should refresh proactively when `expiresAt` is within a
short window of `Date.now()` and write the new credentials back. The
credentials file is mode 0600 and lives at `~/.claude/.credentials.json`.

## Response shape

The CLI destructures the response as a plain object whose top-level keys
each describe one usage window (or `null` if the account does not have
that window). Each window object has two numeric fields used by the CLI:
`utilization` (percent used, 0-100) and `resets_at` (ISO-8601 string).

Abbreviated example (numbers redacted):

```json
{
  "five_hour": {
    "utilization": 42,
    "resets_at": "2026-05-29T21:00:00Z"
  },
  "seven_day": {
    "utilization": 42,
    "resets_at": "2026-06-02T00:00:00Z"
  },
  "seven_day_sonnet": {
    "utilization": 42,
    "resets_at": "2026-06-02T00:00:00Z"
  },
  "extra_usage": {
    "is_enabled": true,
    "monthly_limit": 42,
    "used_credits": 42,
    "utilization": 42
  }
}
```

Notes about the shape (all derived from how the CLI consumes it):

- Any of the three window keys may be `null` — the CLI renders nothing
  for a `null` window. Plan accordingly.
- `utilization` may be `null` inside a window object — same treatment.
- `extra_usage.is_enabled` is a boolean. When `false`, the other
  `extra_usage` fields are not meaningful.
- `extra_usage.monthly_limit` may be `null` (unlimited).
- `extra_usage.used_credits` and `extra_usage.monthly_limit` are in
  cents (the CLI divides by 100 for display). They represent dollars
  spent / cap on extra usage. The CLI feeds `extra_usage` to the same
  renderer as the windows, synthesizing a `resets_at` of "first of next
  month".
- `resets_at` on the three window fields is parsed by the CLI via
  `new Date(resets_at)`, so it accepts standard ISO-8601 strings. (Whether
  it is delivered as ISO string or epoch ms is the one detail not pinned
  down from the bundle alone — Task 6 should tolerate both: if `typeof
  resets_at === "number"`, treat as epoch ms; if string, parse as ISO.)
- The CLI labels the windows internally as:
  - `five_hour` -> "Current session" / "session limit"
  - `seven_day` -> "Current week (all models)" / "weekly limit"
  - `seven_day_sonnet` -> "Current week (Sonnet only)"
  - `seven_day_opus` ("Opus limit") is referenced in rate-limit error
    handling but does not appear in the `/usage` response render path
    in 2.1.33. If it shows up later it follows the same shape.

## Mapping plan to `UsageWindow[]`

The spec's `UsageWindow` shape (per project types) is:

```ts
{ label: string; usedPct: number; resetsAt: string /* ISO */ }
```

The collector should:

1. `GET` the endpoint with the headers above.
2. For each known window key, if the value is non-null and `utilization`
   is a finite number, emit a `UsageWindow`:

   | Response key        | `label`    | `usedPct`          | `resetsAt`                                  |
   |---------------------|------------|--------------------|---------------------------------------------|
   | `five_hour`         | `"5h"`     | `Math.round(v.utilization)` | normalize `v.resets_at` to ISO string |
   | `seven_day`         | `"weekly"` | `Math.round(v.utilization)` | normalize `v.resets_at` to ISO string |

3. `seven_day_sonnet` and `extra_usage` are out of scope for the MVP
   `UsageWindow[]` (spec asks only for `"5h"` and `"weekly"`); collector
   may ignore them but should not crash if they're absent or take a
   different shape.

4. `resetsAt` normalization: if `resets_at` is a string, pass through
   after `new Date(s).toISOString()` to canonicalize; if it's a number,
   `new Date(n).toISOString()`. Skip the window if the date is invalid.

5. If a window's `utilization` is `null`, skip that window (don't emit a
   zero — it would misrepresent state).

6. If the entire HTTP response is non-2xx after refresh, the collector
   should surface a typed error so the UI can show "usage unavailable"
   rather than zeros. 401 means the refresh didn't help (revoked
   token) — treat as fatal-but-recoverable on next login.

## Probe status (transparency)

A live probe was attempted from this machine; outcome:

- The on-disk OAuth token in `~/.claude/.credentials.json` was 15 days
  expired (running Claude Code sessions hold refreshed tokens only in
  memory; they don't write back during the session).
- The macOS Keychain copy (`Claude Code-credentials`) was equally stale.
- A `POST https://platform.claude.com/v1/oauth/token` refresh attempt
  returned `429 rate_limit_error` repeatedly across multiple back-off
  windows; the unauthenticated `GET /api/oauth/usage` probe also
  returned `429` from the same IP. Repeated attempts compounded the
  rate limit.
- With the stale token, `GET /api/oauth/usage` returned `401
  authentication_error` (`request_id: req_011CbWMAhPJKQF19fDFoKygF`),
  which confirms the URL is correct (a wrong path would 404).

Confidence: the endpoint URL, method, headers, and per-window
field names (`five_hour`, `seven_day`, `seven_day_sonnet`,
`extra_usage` -> `{ utilization, resets_at }`) are taken directly
from the bundle's consumer code, so the mapping plan is sound. The one
detail not 100% pinned without a successful live JSON dump is whether
`resets_at` is delivered as ISO string or epoch ms; Task 6 should
tolerate both. A successful live probe from the developer machine
after the rate limit clears (or after the next Claude Code launch
refreshes the on-disk credential) would let Task 6 lock that detail
down before shipping.

## Other endpoints surfaced during the grep (for context)

These were not the target but are documented so we know what they are:

- `/api/oauth/profile` — user profile
- `/api/oauth/account/settings` — account-level settings
- `/api/oauth/account/grove_notice_viewed` — UI dismissal flag
- `/api/oauth/claude_cli/client_data` — CLI registration data
- `/api/oauth/claude_cli/create_api_key` — provision an API key
- `/api/oauth/claude_cli/roles` — role list
- `/api/oauth/organizations/` — org list
- `/v1/oauth/token` (on `platform.claude.com`) — token refresh endpoint
- `/v1/oauth/hello` (on `platform.claude.com`) — health/identity probe

Only `/api/oauth/usage` returns the per-window utilization payload.
