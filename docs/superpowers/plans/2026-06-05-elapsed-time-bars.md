# Elapsed-Time Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a thin time-elapsed bar directly under each usage bar (Claude Code + Codex, 5h + weekly) so the user can see at a glance whether token usage is ahead of or behind the window's clock.

**Architecture:** Add an optional `windowSecs` field to `UsageWindow`. Codex populates it from the app-server's real `windowDurationMins`; Claude hardcodes 18000/604800 per API field (the OAuth usage API reports no durations). `LimitGauge` computes `elapsedPercent = clamp((windowSecs − (resetAt − now)) / windowSecs × 100, 0, 100)` off its existing per-second tick and renders a 4px gray bar connected beneath the 8px usage bar. Missing `windowSecs` (old disk snapshots, null Codex durations) → no elapsed bar, identical to today.

**Tech Stack:** Next.js (App Router, client components, inline styles), TypeScript, Vitest. Test command: `npx vitest run` from the repo root.

**Spec:** `docs/superpowers/specs/2026-06-05-elapsed-time-bars-design.md`

---

### Task 1: `windowSecs` in the data model + Codex mapping

**Files:**
- Modify: `lib/types.ts:1-5`
- Modify: `lib/codex.ts:22-27`
- Test: `lib/__tests__/codex.test.ts`

- [ ] **Step 1: Update the existing Codex test to expect `windowSecs`, and add a null-duration test**

The fixture at the top of `lib/__tests__/codex.test.ts` already carries `windowDurationMins: 300` (primary) and `10080` (secondary). Update the first assertion in the `parseRateLimitsResult` describe block:

```ts
  it("maps primary -> 5h and secondary -> weekly", () => {
    const result = parseRateLimitsResult(liveResult, 1780135575);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows).toEqual([
      { label: "5h", usedPercent: 0, resetAt: 1780153759, windowSecs: 18000 },
      { label: "weekly", usedPercent: 100, resetAt: 1780172156, windowSecs: 604800 },
    ]);
    expect(result.snapshotAt).toBe(1780135575);
  });
```

Then add a new test at the end of the same describe block:

```ts
  it("omits windowSecs when windowDurationMins is null or missing", () => {
    const result = parseRateLimitsResult(
      {
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: null, resetsAt: 1780153759 },
          secondary: { usedPercent: 10, resetsAt: 1780172156 },
        },
      },
      0
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows[0]).not.toHaveProperty("windowSecs");
    expect(result.windows[1]).not.toHaveProperty("windowSecs");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/codex.test.ts`
Expected: FAIL — "maps primary -> 5h..." fails because actual windows lack `windowSecs`; the new test passes incidentally (the property genuinely isn't set yet), which is fine — it guards the omission path going forward.

- [ ] **Step 3: Add `windowSecs` to `UsageWindow` and populate it in `mapWindow`**

In `lib/types.ts`, replace the `UsageWindow` type:

```ts
export type UsageWindow = {
  label: string;      // e.g. "5h" | "weekly"
  usedPercent: number;
  resetAt: number;    // unix seconds
  windowSecs?: number; // window duration in seconds; omitted when unknown
};
```

In `lib/codex.ts`, replace `mapWindow`:

```ts
function mapWindow(w: AppServerWindow | undefined, label: string): UsageWindow | null {
  if (!w) return null;
  if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return null;
  if (typeof w.resetsAt !== "number" || !Number.isFinite(w.resetsAt)) return null;
  const win: UsageWindow = { label, usedPercent: w.usedPercent, resetAt: w.resetsAt };
  // Duration can be null/missing (older codex builds); omit windowSecs so the
  // UI simply skips the elapsed bar rather than rendering garbage.
  if (typeof w.windowDurationMins === "number" && Number.isFinite(w.windowDurationMins)) {
    win.windowSecs = w.windowDurationMins * 60;
  }
  return win;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/codex.test.ts`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/codex.ts lib/__tests__/codex.test.ts
git commit -m "feat(codex): expose window duration as windowSecs on UsageWindow"
```

---

### Task 2: Claude mapping

**Files:**
- Modify: `lib/claude.ts:102-123` (`extract` and `normalizeClaudeUsage`)
- Test: `lib/__tests__/claude.test.ts`

- [ ] **Step 1: Extend the existing normalize test to assert `windowSecs`**

In `lib/__tests__/claude.test.ts`, replace the first test in the `normalizeClaudeUsage` describe block:

```ts
  it("returns two windows labelled '5h' and 'weekly'", () => {
    const result = normalizeClaudeUsage(fixture);
    if (!result.ok) throw new Error("expected ok");
    expect(result.windows.map((w) => w.label)).toEqual(["5h", "weekly"]);
    expect(result.windows.map((w) => w.windowSecs)).toEqual([18000, 604800]);
    for (const w of result.windows) {
      expect(w.usedPercent).toBeGreaterThanOrEqual(0);
      expect(w.usedPercent).toBeLessThanOrEqual(100);
      expect(w.resetAt).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/claude.test.ts`
Expected: FAIL — `windowSecs` map yields `[undefined, undefined]`

- [ ] **Step 3: Thread `windowSecs` through `extract`**

In `lib/claude.ts`, replace `extract` and the two call sites in `normalizeClaudeUsage`:

```ts
function extract(v: unknown, label: string, windowSecs: number): UsageWindow | null {
  if (!v || typeof v !== "object") return null;
  const w = v as Window;
  if (typeof w.utilization !== "number") return null;
  const reset = tsFrom(w.resets_at);
  if (reset == null) return null;
  return { label, usedPercent: w.utilization, resetAt: reset, windowSecs };
}
```

```ts
  // The OAuth usage API reports no window durations, so they're fixed here:
  // five_hour is 5h, seven_day is 7d.
  const fiveHour = extract(r.five_hour, "5h", 5 * 3600);
  const weekly = extract(r.seven_day, "weekly", 7 * 24 * 3600);
```

(Only those two lines change inside `normalizeClaudeUsage`; the rest of the function stays as is.)

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `npx vitest run`
Expected: PASS — including the untouched "last-good disk cache" tests, whose stored windows lack `windowSecs` (the field is optional, so `isUsageWindow` still accepts them).

- [ ] **Step 5: Commit**

```bash
git add lib/claude.ts lib/__tests__/claude.test.ts
git commit -m "feat(claude): set windowSecs on 5h/weekly usage windows"
```

---

### Task 3: Elapsed bar in `LimitGauge` + wire through `page.tsx`

No component test infra exists in this repo (Vitest covers `lib/` only; no jsdom/RTL) — verification for this task is type-check + visual check in the dev server, consistent with how every other component here was built.

**Files:**
- Modify: `components/LimitGauge.tsx`
- Modify: `app/page.tsx:124-126` (the `data.windows.map` inside `UsagePanel`)

- [ ] **Step 1: Render the elapsed bar in `LimitGauge`**

In `components/LimitGauge.tsx`, replace the `LimitGauge` function:

```tsx
export function LimitGauge({ label, usedPercent, resetAt, windowSecs, stale = false }: {
  label: string; usedPercent: number; resetAt: number; windowSecs?: number; stale?: boolean;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    // Stale gauges don't need a per-second tick (the reset timer is hidden).
    if (stale) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [stale]);
  const remaining = Math.max(0, resetAt - now);
  const color = colorFor(usedPercent);
  // Time elapsed in the window, as a percent. Clamped: a passed resetAt reads
  // 100%, clock skew (remaining > windowSecs) reads 0%. Null when the window
  // duration is unknown (old snapshots) — then no elapsed bar is drawn.
  const elapsedPercent = windowSecs
    ? Math.min(100, Math.max(0, ((windowSecs - remaining) / windowSecs) * 100))
    : null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "#9aa6b8" }}>{label}</span>
        <span>
          <strong>{usedPercent.toFixed(0)}%</strong>
          {!stale && <> · resets in {fmtCountdown(remaining)}</>}
        </span>
      </div>
      <div style={{
        background: "#0b0d10", height: 8, overflow: "hidden",
        borderRadius: elapsedPercent != null ? "4px 4px 0 0" : 4,
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
          height: "100%", background: color, transition: "width 400ms ease",
        }} />
      </div>
      {elapsedPercent != null && (
        <div style={{
          background: "#0b0d10", height: 4, borderRadius: "0 0 4px 4px",
          overflow: "hidden", marginTop: 2,
        }}>
          <div style={{
            width: `${elapsedPercent}%`,
            height: "100%", background: "#5b6678", transition: "width 1s linear",
          }} />
        </div>
      )}
    </div>
  );
}
```

(`colorFor` and `fmtCountdown` at the top of the file are untouched.)

- [ ] **Step 2: Pass `windowSecs` through in `UsagePanel`**

In `app/page.tsx`, inside `UsagePanel`, replace the `data.windows.map` line:

```tsx
        {data.windows.map(w => (
          <LimitGauge key={w.label} label={w.label} usedPercent={w.usedPercent} resetAt={w.resetAt} windowSecs={w.windowSecs} stale={isStale} />
        ))}
```

- [ ] **Step 3: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests PASS

- [ ] **Step 4: Visual check in the dev server**

Run the dev server (`npm run dev`), open `http://localhost:3000`, and confirm:
- Each gauge (Claude 5h/weekly, Codex 5h/weekly) shows a thin gray bar attached under the colored bar with a 2px gap, top corners of the pair rounded on the usage bar and bottom corners on the elapsed bar.
- The gray bar length matches intuition (e.g. weekly window ~mid-week ≈ ~50%).
- If a provider is stale, the pair is dimmed together.

- [ ] **Step 5: Commit**

```bash
git add components/LimitGauge.tsx app/page.tsx
git commit -m "feat(gauge): elapsed-time bar under usage bars to show token pace"
```
