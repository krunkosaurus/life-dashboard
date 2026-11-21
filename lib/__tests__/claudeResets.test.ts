import { describe, it, expect } from "vitest";
import { normalizeClaudeBonusResets } from "../claudeResets";
import { normalizeClaudeUsage } from "../claude";
import fixture from "./fixtures/claude-usage.json";

const now = Date.parse("2026-09-23T05:00:00Z") / 1000;
const grant = {
  id: "private-grant-id",
  label: "One-time bonus reset",
  resets_total: 1,
  resets_left: 1,
  starts_at: "2026-09-22T00:00:00Z",
  ends_at: "2026-10-01T00:00:00Z",
  clears: ["five_hour", "seven_day"],
  paused: false,
  usable_now: true,
  use_requires_limit: false,
};

describe("Claude bonus-reset status", () => {
  it("maps a confirmed grant without exposing its redemption ID", () => {
    const result = normalizeClaudeBonusResets({ eligible: true, grants: [grant] }, now);
    expect(result).toEqual({
      state: "known",
      grants: [{
        title: "One-time bonus reset",
        remaining: 1,
        startsAt: Date.parse(grant.starts_at) / 1000,
        expiresAt: Date.parse(grant.ends_at) / 1000,
        paused: false,
        usableNow: true,
        requiresLimit: false,
        limits: ["5-hour limit", "weekly limit"],
      }],
    });
    expect(JSON.stringify(result)).not.toContain(grant.id);
  });

  it("does not equate the live CLI surface restriction with zero resets", () => {
    expect(normalizeClaudeBonusResets({
      eligible: false, ineligible_reason: "surface", grants: [], next_grant_id: null,
    }, now)).toEqual({ state: "unknown", reason: "surface" });
  });

  it("distinguishes missing and unavailable responses from a confirmed empty bank", () => {
    expect(normalizeClaudeBonusResets(null, now)).toEqual({ state: "unknown", reason: "not_reported" });
    expect(normalizeClaudeBonusResets({ eligible: false, ineligible_reason: "config_off" }, now))
      .toEqual({ state: "unknown", reason: "unavailable" });
    expect(normalizeClaudeBonusResets({ eligible: false, ineligible_reason: "no_grant" }, now))
      .toEqual({ state: "known", grants: [] });
    expect(normalizeClaudeBonusResets({ eligible: true, grants: [] }, now))
      .toEqual({ state: "known", grants: [] });
  });

  it("excludes spent and expired grants, including the exact expiry boundary", () => {
    const spent = { ...grant, resets_left: 0 };
    const expired = { ...grant, ends_at: new Date(now * 1000).toISOString() };
    expect(normalizeClaudeBonusResets({ eligible: true, grants: [spent, expired, grant] }, now))
      .toMatchObject({ state: "known", grants: [{ remaining: 1 }] });
  });

  it.each([undefined, null, {}, [{ ...grant, resets_left: -1 }], [{ ...grant, resets_left: 0.5 }],
    [{ ...grant, resets_left: "1" }], [{ ...grant, ends_at: "invalid" }], [null], [grant, {}]])(
    "does not report a false zero or partial count for malformed grants %j", (grants) => {
      expect(normalizeClaudeBonusResets({ eligible: true, grants }, now))
        .toEqual({ state: "unknown", reason: "unavailable" });
    },
  );

  it("preserves multiple resets, restrictions, and a nullable expiry", () => {
    const result = normalizeClaudeBonusResets({
      eligible: true,
      cooldown_until: "2026-09-24T00:00:00Z",
      grants: [{ ...grant, resets_left: 2, paused: true, usable_now: false, use_requires_limit: true, ends_at: null }],
    }, now);
    expect(result).toMatchObject({
      state: "known", cooldownUntil: Date.parse("2026-09-24T00:00:00Z") / 1000,
      grants: [{ remaining: 2, paused: true, usableNow: false, requiresLimit: true }],
    });
    if (result.state !== "known") throw new Error("Expected known status");
    expect(result.grants[0].expiresAt).toBeUndefined();
  });

  it("includes reset status alongside the ordinary usage windows", () => {
    expect(normalizeClaudeUsage({ ...fixture, cedar_ember: { eligible: false, ineligible_reason: "surface", grants: [] } }))
      .toMatchObject({ ok: true, windows: expect.any(Array), bonusResets: { state: "unknown", reason: "surface" } });
  });
});
