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

  it("parses tailscaleHosts, trims values, drops malformed entries", () => {
    const cfg = parseConfig(
      {
        tailscaleHosts: [
          { host: "blackpi", alias: "Coldplunge" },
          { host: " winton.tail87750.ts.net ", alias: "  PasirRis Winton " },
          { host: "100.126.38.102" },
          { host: "", alias: "empty" },   // empty host -> dropped
          { alias: "no-host" },           // missing host -> dropped
          "not-an-object",                // wrong type -> dropped
        ],
      },
      {}
    );
    expect(cfg.tailscaleHosts).toEqual([
      { host: "blackpi", alias: "Coldplunge" },
      { host: "winton.tail87750.ts.net", alias: "PasirRis Winton" },
      { host: "100.126.38.102" },
    ]);
  });

  it("defaults tailscaleHosts to an empty array when missing", () => {
    expect(parseConfig({}, {}).tailscaleHosts).toEqual([]);
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

describe("parseConfig analytics", () => {
  const valid = {
    analytics: {
      title: "Analytics",
      days: ["Jun 8", "Jun 9", "Jun 10"],
      locations: [
        {
          name: "Site A",
          url: "https://site-a.example.com/admin/analytics",
          charts: [
            {
              title: "Generation",
              series: [
                { label: "Batches", values: [1, 2, 3] },
                { label: "Photos", values: [10, 20, 30] },
              ],
            },
          ],
        },
      ],
    },
  };

  it("parses a valid analytics block", () => {
    expect(parseConfig(valid, {}).analytics).toEqual(valid.analytics);
  });

  it("defaults analytics to null when missing", () => {
    expect(parseConfig({}, {}).analytics).toBeNull();
  });

  it('defaults the title to "Analytics" when absent or blank', () => {
    const locations = valid.analytics.locations;
    expect(parseConfig({ analytics: { locations } }, {}).analytics?.title).toBe("Analytics");
    expect(parseConfig({ analytics: { title: "  ", locations } }, {}).analytics?.title).toBe("Analytics");
  });

  it("coerces non-finite series values to 0", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locations: [
            { name: "X", charts: [{ title: "C", series: [{ label: "S", values: [1, "bad", null, 4, NaN] }] }] },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locations[0].charts[0].series[0].values).toEqual([1, 0, 0, 4, 0]);
  });

  it("keeps only string day labels", () => {
    const cfg = parseConfig(
      { analytics: { days: ["Mon", 2, null, "Wed"], locations: valid.analytics.locations } },
      {}
    );
    expect(cfg.analytics?.days).toEqual(["Mon", "Wed"]);
  });

  it("omits url when absent or blank", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locations: [
            { name: "NoUrl", charts: [{ title: "C", series: [{ label: "S", values: [1] }] }] },
            { name: "BlankUrl", url: "  ", charts: [{ title: "C", series: [{ label: "S", values: [1] }] }] },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locations[0]).not.toHaveProperty("url");
    expect(cfg.analytics?.locations[1]).not.toHaveProperty("url");
  });

  it("parses optional analytics chart presentation controls", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locationLayout: "grid",
          locations: [
            {
              name: "Stacked",
              chartLayout: "vertical",
              syncHover: true,
              charts: [{ title: "C", series: [{ label: "S", values: [1] }] }],
            },
            {
              name: "ExplicitGrid",
              chartLayout: "grid",
              syncHover: false,
              charts: [{ title: "C", series: [{ label: "S", values: [1] }] }],
            },
            {
              name: "InvalidPresentation",
              chartLayout: "sideways",
              syncHover: "yes",
              charts: [{ title: "C", series: [{ label: "S", values: [1] }] }],
            },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locationLayout).toBe("grid");
    expect(cfg.analytics?.locations[0]).toMatchObject({ chartLayout: "vertical", syncHover: true });
    expect(cfg.analytics?.locations[1]).toMatchObject({ chartLayout: "grid", syncHover: false });
    expect(cfg.analytics?.locations[2]).not.toHaveProperty("chartLayout");
    expect(cfg.analytics?.locations[2]).not.toHaveProperty("syncHover");
  });

  it("drops invalid analytics location layout values", () => {
    const cfg = parseConfig(
      { analytics: { locationLayout: "columns", locations: valid.analytics.locations } },
      {}
    );
    expect(cfg.analytics).not.toHaveProperty("locationLayout");
  });

  it("drops malformed locations, charts, and series", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locations: [
            "not-an-object",
            { name: "", charts: [{ title: "C", series: [{ label: "S", values: [1] }] }] }, // blank name
            { name: "NoCharts", charts: [] }, // no charts
            { name: "BadChartOnly", charts: [{ title: "", series: [] }] }, // chart invalid -> location dropped
            {
              name: "Good",
              charts: [
                {
                  title: "C",
                  series: [
                    { label: "ok", values: [1] },
                    { label: "", values: [1] }, // blank label -> dropped
                    { label: "novals", values: [] }, // empty values -> dropped
                    { label: "notarray", values: "x" }, // non-array -> dropped
                  ],
                },
                { title: "Empty", series: [] }, // no valid series -> chart dropped
              ],
            },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locations).toHaveLength(1);
    expect(cfg.analytics?.locations[0].name).toBe("Good");
    expect(cfg.analytics?.locations[0].charts).toHaveLength(1);
    expect(cfg.analytics?.locations[0].charts[0].series).toEqual([{ label: "ok", values: [1] }]);
  });

  it("returns null when nothing survives validation", () => {
    expect(parseConfig({ analytics: "nope" }, {}).analytics).toBeNull();
    expect(parseConfig({ analytics: { locations: "nope" } }, {}).analytics).toBeNull();
    expect(parseConfig({ analytics: { locations: [{ name: "x", charts: [] }] } }, {}).analytics).toBeNull();
  });

  it("parses a live source with api, origin, params and dateField", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locations: [
            {
              name: "Site A",
              url: "https://a.example.com/admin/analytics",
              source: {
                api: "https://api.example.com/historical",
                origin: "https://a.example.com",
                params: { days: 7, theme: "a" },
                dateField: "day",
              },
              charts: [{ title: "Generation", series: [{ label: "Batches", field: "batches" }] }],
            },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locations[0].source).toEqual({
      api: "https://api.example.com/historical",
      origin: "https://a.example.com",
      params: { days: 7, theme: "a" },
      dateField: "day",
    });
    expect(cfg.analytics?.locations[0].charts[0].series[0]).toEqual({ label: "Batches", field: "batches" });
  });

  it("drops a source without an api url and trims field names", () => {
    const cfg = parseConfig(
      {
        analytics: {
          locations: [
            {
              name: "X",
              source: { origin: "https://x.example.com" }, // no api -> source dropped
              charts: [{ title: "C", series: [{ label: "S", field: "  f  " }] }],
            },
          ],
        },
      },
      {}
    );
    expect(cfg.analytics?.locations[0]).not.toHaveProperty("source");
    expect(cfg.analytics?.locations[0].charts[0].series[0]).toEqual({ label: "S", field: "f" });
  });

  it("keeps a series valid when it has a field but no values", () => {
    const cfg = parseConfig(
      { analytics: { locations: [{ name: "X", charts: [{ title: "C", series: [{ label: "S", field: "f" }] }] }] } },
      {}
    );
    expect(cfg.analytics?.locations[0].charts[0].series).toEqual([{ label: "S", field: "f" }]);
  });
});

describe("parseConfig checklists", () => {
  it("parses a checklists block via parseChecklists", () => {
    const cfg = parseConfig(
      { checklists: { title: "Daily", weekStart: "sun", items: [{ group: "Morning", label: "Cold plunge" }] } },
      {}
    );
    expect(cfg.checklists?.title).toBe("Daily");
    expect(cfg.checklists?.weekStart).toBe(0);
    expect(cfg.checklists?.items[0]).toEqual({
      id: "morning-cold-plunge",
      label: "Cold plunge",
      group: "Morning",
      repeat: "daily",
    });
  });

  it("defaults checklists to null when missing or with no valid items", () => {
    expect(parseConfig({}, {}).checklists).toBeNull();
    expect(parseConfig({ checklists: { items: [] } }, {}).checklists).toBeNull();
    expect(parseConfig({ checklists: "nope" }, {}).checklists).toBeNull();
  });
});
