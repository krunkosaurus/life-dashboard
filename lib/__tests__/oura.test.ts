import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  ouraDateRange,
  selectedOuraDay,
  selectDailyActivity,
  selectDailySleep,
  selectLatestHeartRateTimestamp,
  selectPrimarySleep,
  summarizeOuraDocuments,
  ymdInTimeZone,
} from "../oura";

describe("Oura date helpers", () => {
  it("formats a date in the configured Oura timezone", () => {
    const now = new Date("2026-07-01T17:30:00Z");
    expect(ymdInTimeZone(now, "Asia/Singapore")).toBe("2026-07-02");
    expect(ymdInTimeZone(now, "America/Los_Angeles")).toBe("2026-07-01");
  });

  it("adds whole calendar days to YYYY-MM-DD values", () => {
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds the today/yesterday range in the requested timezone", () => {
    expect(ouraDateRange(new Date("2026-07-01T17:30:00Z"), "Asia/Singapore")).toEqual({
      today: "2026-07-02",
      yesterday: "2026-07-01",
    });
  });

  it("selects a requested past day or clamps future offsets to today", () => {
    const now = new Date("2026-07-02T04:00:00Z");
    expect(selectedOuraDay({ day: "2026-07-01" }, now, "Asia/Singapore")).toBe("2026-07-01");
    expect(selectedOuraDay({ day: "2026-07-03" }, now, "Asia/Singapore")).toBe("2026-07-02");
    expect(selectedOuraDay({ dayOffset: -2 }, now, "Asia/Singapore")).toBe("2026-06-30");
    expect(selectedOuraDay({ dayOffset: 2 }, now, "Asia/Singapore")).toBe("2026-07-02");
  });
});

describe("Oura document selection", () => {
  it("selects the latest daily sleep document not after today", () => {
    expect(selectDailySleep([
      { day: "2026-07-01", score: 78 },
      { day: "2026-07-02", score: 84 },
      { day: "2026-07-03", score: 90 },
    ], "2026-07-02")).toEqual({ day: "2026-07-02", score: 84 });
  });

  it("prefers the long sleep for the selected day", () => {
    expect(selectPrimarySleep([
      { day: "2026-07-02", type: "sleep", total_sleep_duration: 1800 },
      { day: "2026-07-02", type: "long_sleep", total_sleep_duration: 27000 },
      { day: "2026-07-02", type: "rest", total_sleep_duration: 30000 },
    ], "2026-07-02", "2026-07-02")).toMatchObject({
      type: "long_sleep",
      total_sleep_duration: 27000,
    });
  });

  it("selects today's daily activity document", () => {
    expect(selectDailyActivity([
      { day: "2026-07-01", steps: 1000 },
      { day: "2026-07-02", steps: 4321 },
    ], "2026-07-02")).toEqual({ day: "2026-07-02", steps: 4321 });
  });

  it("selects the latest valid heart-rate timestamp as the sync estimate", () => {
    expect(selectLatestHeartRateTimestamp([
      { timestamp: "not-a-date" },
      { timestamp: "2026-07-02T08:15:00+08:00" },
      { timestamp: "2026-07-02T09:40:00+08:00" },
    ])).toBe("2026-07-02T09:40:00+08:00");
  });
});

describe("summarizeOuraDocuments", () => {
  it("maps sleep and steps into the dashboard summary", () => {
    const summary = summarizeOuraDocuments(
      [{ day: "2026-07-02", score: 88, timestamp: "2026-07-02T07:05:00+08:00" }],
      [{
        day: "2026-07-02",
        type: "long_sleep",
        bedtime_start: "2026-07-01T23:10:00+08:00",
        bedtime_end: "2026-07-02T06:50:00+08:00",
        total_sleep_duration: 25200,
        time_in_bed: 27600,
        efficiency: 91,
        deep_sleep_duration: 5400,
        rem_sleep_duration: 7200,
      }],
      [{ day: "2026-07-02", steps: 4567, score: 72, active_calories: 350, timestamp: "2026-07-02T14:30:00+08:00" }],
      "2026-07-02",
      "Asia/Singapore",
    );

    expect(summary.day).toBe("2026-07-02");
    expect(summary.sleep).toMatchObject({
      day: "2026-07-02",
      score: 88,
      totalSleepSeconds: 25200,
      efficiency: 91,
      deepSleepSeconds: 5400,
      remSleepSeconds: 7200,
    });
    expect(summary.activity).toMatchObject({
      day: "2026-07-02",
      steps: 4567,
      score: 72,
      activeCalories: 350,
    });
  });

  it("returns null when no valid heart-rate timestamp is available", () => {
    expect(selectLatestHeartRateTimestamp([
      { timestamp: "not-a-date" },
      { timestamp: "" },
      {},
    ])).toBeNull();
  });

  it("does not use the previous day's sleep when the selected day has no sleep", () => {
    const summary = summarizeOuraDocuments(
      [{ day: "2026-07-01", score: 80 }],
      [{ day: "2026-07-01", type: "long_sleep", total_sleep_duration: 25000 }],
      [{ day: "2026-07-02", steps: 3000 }],
      "2026-07-02",
      "Asia/Singapore",
    );

    expect(summary.day).toBe("2026-07-02");
    expect(summary.sleep).toBeNull();
    expect(summary.activity).toMatchObject({ day: "2026-07-02", steps: 3000 });
  });
});
