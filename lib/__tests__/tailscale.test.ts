import { describe, it, expect } from "vitest";
import { normalizeHostKey, parseTailscaleStatus } from "../tailscale";

const STATUS = {
  Self: {
    HostName: "macbook-pro-5",
    DNSName: "macbook-pro-5.tail87750.ts.net.",
    OS: "macOS",
    TailscaleIPs: ["100.67.73.48"],
    Online: true,
    LastSeen: "0001-01-01T00:00:00Z",
  },
  Peer: {
    "key1": {
      HostName: "blackpi",
      DNSName: "blackpi.tail87750.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.115.169.2"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
    "key2": {
      HostName: "bluey",
      DNSName: "bluey.tail87750.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.111.237.16"],
      Online: false,
      LastSeen: "2026-02-25T10:00:00Z",
    },
    "key3": {
      HostName: "DESKTOP-CQ48FBP",
      DNSName: "desktop-cq48fbp.tail87750.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.126.38.102"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
  },
};

describe("normalizeHostKey", () => {
  it("lowercases and takes the first label of FQDNs", () => {
    expect(normalizeHostKey("Winton.tail87750.ts.net")).toBe("winton");
    expect(normalizeHostKey("blackpi")).toBe("blackpi");
  });

  it("keeps IPv4 addresses verbatim", () => {
    expect(normalizeHostKey("100.126.38.102")).toBe("100.126.38.102");
  });
});

describe("parseTailscaleStatus", () => {
  it("matches by bare hostname, FQDN, and Tailscale IP", () => {
    const servers = parseTailscaleStatus(STATUS, [
      { host: "blackpi", alias: "Coldplunge" },
      { host: "bluey.tail87750.ts.net", alias: "Bluey" },
      { host: "100.126.38.102", alias: "2gpu" },
    ]);
    expect(servers).toHaveLength(3);
    expect(servers[0]).toMatchObject({ alias: "Coldplunge", online: true, found: true, os: "linux" });
    expect(servers[1]).toMatchObject({ alias: "Bluey", online: false, found: true });
    expect(servers[2]).toMatchObject({ alias: "2gpu", online: true, found: true });
  });

  it("reports lastSeen for offline peers and null for the zero timestamp", () => {
    const servers = parseTailscaleStatus(STATUS, [
      { host: "blackpi" },
      { host: "bluey" },
    ]);
    expect(servers[0].lastSeen).toBeNull();
    expect(servers[1].lastSeen).toBe(Math.floor(Date.parse("2026-02-25T10:00:00Z") / 1000));
  });

  it("includes Self in matching", () => {
    const [self] = parseTailscaleStatus(STATUS, [{ host: "macbook-pro-5" }]);
    expect(self).toMatchObject({ online: true, found: true, os: "macOS" });
  });

  it("marks unknown hosts as not found and offline", () => {
    const [ghost] = parseTailscaleStatus(STATUS, [{ host: "no-such-box", alias: "Ghost" }]);
    expect(ghost).toMatchObject({ alias: "Ghost", online: false, found: false, lastSeen: null });
  });

  it("falls back to host for the alias", () => {
    const [s] = parseTailscaleStatus(STATUS, [{ host: "blackpi" }]);
    expect(s.alias).toBe("blackpi");
  });

  it("tolerates malformed status output", () => {
    expect(parseTailscaleStatus(null, [{ host: "blackpi" }])[0].found).toBe(false);
    expect(parseTailscaleStatus({ Peer: "nope" }, [{ host: "blackpi" }])[0].found).toBe(false);
    expect(parseTailscaleStatus({ Peer: { k: { DNSName: 5, Online: "yes" } } }, [{ host: "blackpi" }])[0].found).toBe(false);
  });
});
