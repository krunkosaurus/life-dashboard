import { describe, it, expect } from "vitest";
import { parseConfig } from "../config";

describe("parseConfig", () => {
  it("returns defaults when given empty object", () => {
    const cfg = parseConfig({}, {});
    expect(cfg.icsUrl).toBeNull();
    expect(cfg.pinnedEvents).toEqual([]);
    expect(cfg.refreshSeconds).toBe(60);
  });

  it("reads icsUrl, pinnedEvents and refreshSeconds from the file", () => {
    const cfg = parseConfig(
      { icsUrl: "https://x/y.ics", pinnedEvents: ["A", "B"], refreshSeconds: 30 },
      {}
    );
    expect(cfg.icsUrl).toBe("https://x/y.ics");
    expect(cfg.pinnedEvents).toEqual(["A", "B"]);
    expect(cfg.refreshSeconds).toBe(30);
  });

  it("env ICS_URL overrides file icsUrl", () => {
    const cfg = parseConfig({ icsUrl: "from-file" }, { ICS_URL: "from-env" });
    expect(cfg.icsUrl).toBe("from-env");
  });

  it("clamps refreshSeconds to a minimum of 5", () => {
    const cfg = parseConfig({ refreshSeconds: 1 }, {});
    expect(cfg.refreshSeconds).toBe(5);
  });

  it("treats the example-config placeholder as unset", () => {
    const cfg = parseConfig(
      { icsUrl: "https://calendar.google.com/calendar/ical/.../basic.ics" },
      {}
    );
    expect(cfg.icsUrl).toBeNull();
  });

  it("treats REPLACE_ME and <paste …> markers as unset", () => {
    expect(parseConfig({ icsUrl: "REPLACE_ME_WITH_URL" }, {}).icsUrl).toBeNull();
    expect(parseConfig({ icsUrl: "<paste your private .ics URL here>" }, {}).icsUrl).toBeNull();
  });

  it("parses manualEvents, drops malformed entries, preserves explicit pinned", () => {
    const cfg = parseConfig(
      {
        manualEvents: [
          { title: "Flight", start: "2099-06-15T08:00:00Z", pinned: true },
          { title: "Birthday", start: "2099-09-12" },
          { title: 123, start: "2099-01-01" },             // bad title -> dropped
          { title: "No start" },                            // missing start -> dropped
          "not-an-object",                                  // wrong type -> dropped
        ],
      },
      {}
    );
    expect(cfg.manualEvents).toEqual([
      { title: "Flight", start: "2099-06-15T08:00:00Z", pinned: true },
      { title: "Birthday", start: "2099-09-12" },
    ]);
  });

  it("defaults manualEvents to an empty array when missing", () => {
    expect(parseConfig({}, {}).manualEvents).toEqual([]);
  });

  it("parses a valid life block", () => {
    const cfg = parseConfig(
      { life: { birthDate: "1990-01-15", expectancyYears: 80 } },
      {}
    );
    expect(cfg.life).toEqual({ birthDate: "1990-01-15", expectancyYears: 80 });
  });

  it("treats a malformed life block as unset", () => {
    expect(parseConfig({}, {}).life).toBeNull();
    expect(parseConfig({ life: "1990-01-15" }, {}).life).toBeNull();
    expect(parseConfig({ life: { birthDate: "not-a-date", expectancyYears: 80 } }, {}).life).toBeNull();
    expect(parseConfig({ life: { birthDate: "1990-01-15", expectancyYears: 0 } }, {}).life).toBeNull();
    expect(parseConfig({ life: { birthDate: "1990-01-15" } }, {}).life).toBeNull();
  });
});
