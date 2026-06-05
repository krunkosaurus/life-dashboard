# Elapsed-Time Bars Under Usage Gauges — Design

**Date:** 2026-06-05
**Status:** Approved

## Purpose

The Claude Code and Codex panels show token usage per rate-limit window (5h, weekly)
but give no sense of *pace*. To maximize token use, the user wants to see at a glance
whether usage is ahead of or behind the window's clock: a thin time-elapsed bar
rendered directly under each usage bar, visually connected to it.

Reading: gray (elapsed) bar longer than the colored (usage) bar → behind on usage,
tokens to burn. Shorter → ahead of pace. No numeric pace delta — bars only.

## Data Model

`UsageWindow` (lib/types.ts) gains one optional field:

```ts
export type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt: number;       // unix seconds
  windowSecs?: number;   // window duration; omitted when unknown
};
```

Population:

- **Codex** (lib/codex.ts `mapWindow`): the app-server already reports
  `windowDurationMins` per window — use `windowDurationMins * 60` when it is a
  finite number; omit otherwise. No hardcoded durations.
- **Claude** (lib/claude.ts `extract`): the OAuth usage API does not report
  durations, so set them per field: `five_hour` → 18000, `seven_day` → 604800.

## UI (components/LimitGauge.tsx)

When `windowSecs` is present, render a second, thinner bar (~4px tall, muted
slate-gray fill on the same dark track) directly under the usage bar with a 2px
gap so the pair reads as one connected gauge.

```
elapsedPercent = clamp((windowSecs − (resetAt − now)) / windowSecs × 100, 0, 100)
```

It uses the existing per-second `now` state, so it creeps in real time along with
the reset countdown.

## Edge Cases

- **`windowSecs` missing** (old persisted last-good snapshots on disk lack the
  field; Codex may report a null duration): no elapsed bar — rendering is
  identical to today. The field is optional so `isUsageWindow` validation in
  lib/claude.ts needs no changes.
- **`resetAt` in the past** (stale snapshot): elapsed clamps to 100%. Stale
  gauges are already dimmed to 0.4 opacity, which keeps this honest.
- **`resetAt − now > windowSecs`** (clock skew / fresh window): clamps to 0%.

## Testing

- lib/__tests__/claude.test.ts: assert `windowSecs` is 18000 / 604800 on
  normalized 5h / weekly windows.
- lib/__tests__/codex.test.ts: assert `windowSecs` derives from
  `windowDurationMins * 60`, and is omitted when `windowDurationMins` is
  null/missing.

## Files Touched

1. lib/types.ts — add `windowSecs?` to `UsageWindow`
2. lib/codex.ts — map `windowDurationMins` → `windowSecs`
3. lib/claude.ts — set `windowSecs` per extracted field
4. components/LimitGauge.tsx — render elapsed bar
5. lib/__tests__/claude.test.ts, lib/__tests__/codex.test.ts — new assertions
