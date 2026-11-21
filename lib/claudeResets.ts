import type { ClaudeBonusResetGrant, ClaudeBonusResets } from "./types";

const LIMIT_NAMES: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_overage_included: "weekly model limit",
  seven_day_opus: "Opus weekly limit",
  seven_day_sonnet: "Sonnet weekly limit",
  seven_day_cowork: "Cowork weekly limit",
  seven_day_oauth_apps: "connected apps weekly limit",
};

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

// The `cedar_ember` response and grant fields are used by Claude Code 2.1.280.
// Keep display metadata only; grant IDs and redemption are deliberately absent.
export function normalizeClaudeBonusResets(raw: unknown, now = Date.now() / 1000): ClaudeBonusResets {
  if (raw == null) return { state: "unknown", reason: "not_reported" };
  const unknown: ClaudeBonusResets = { state: "unknown", reason: "unavailable" };
  if (typeof raw !== "object" || Array.isArray(raw)) return unknown;
  const r = raw as Record<string, unknown>;
  if (r.eligible === false) {
    if (r.ineligible_reason === "surface") return { state: "unknown", reason: "surface" };
    if (r.ineligible_reason === "no_grant") return { state: "known", grants: [] };
    return unknown;
  }
  if (r.eligible !== true || !Array.isArray(r.grants)) return unknown;

  const grants: ClaudeBonusResetGrant[] = [];
  for (const item of r.grants) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return unknown;
    const g = item as Record<string, unknown>;
    if (typeof g.resets_left !== "number" || !Number.isSafeInteger(g.resets_left) || g.resets_left < 0) return unknown;
    const expiresAt = timestamp(g.ends_at);
    const startsAt = timestamp(g.starts_at);
    // Missing expiry is fine; a malformed expiry cannot prove a grant is live.
    if ((g.ends_at != null && expiresAt == null) || (g.starts_at != null && startsAt == null)) return unknown;
    if (g.resets_left === 0 || (expiresAt != null && expiresAt <= now)) continue;
    grants.push({
      title: typeof g.label === "string" && g.label.trim() ? g.label : "Bonus reset",
      remaining: g.resets_left,
      ...(expiresAt != null ? { expiresAt } : {}),
      ...(startsAt != null ? { startsAt } : {}),
      paused: g.paused === true,
      usableNow: g.usable_now === true,
      requiresLimit: g.use_requires_limit !== false,
      limits: Array.isArray(g.clears)
        ? [...new Set(g.clears.flatMap((key) => typeof key === "string" && LIMIT_NAMES[key] ? [LIMIT_NAMES[key]] : []))]
        : [],
    });
  }
  const cooldownUntil = timestamp(r.cooldown_until);
  return { state: "known", grants, ...(cooldownUntil != null ? { cooldownUntil } : {}) };
}
