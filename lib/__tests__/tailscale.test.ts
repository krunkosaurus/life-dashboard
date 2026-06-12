import { describe, it, expect } from "vitest";
import { normalizeHostKey, parseTailscaleStatus } from "../tailscale";

const STATUS = {
  Self: {
    HostName: "laptop",
    DNSName: "laptop.tailnet-example.ts.net.",
    OS: "macOS",
    TailscaleIPs: ["100.64.0.10"],
    Online: true,
    LastSeen: "0001-01-01T00:00:00Z",
  },
  Peer: {
    "key1": {
      HostName: "pi-server",
      DNSName: "pi-server.tailnet-example.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.64.0.11"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
    "key2": {
      HostName: "nas",
      DNSName: "nas.tailnet-example.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.64.0.12"],
      Online: false,
      LastSeen: "2026-02-25T10:00:00Z",
    },
    "key3": {
      HostName: "DESKTOP-ABC123",
      DNSName: "desktop-abc123.tailnet-example.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.64.0.13"],
      Online: true,
      LastSeen: "0001-01-01T00:00:00Z",
    },
  },
};

describe("normalizeHostKey", () => {
  it("lowercases and takes the first label of FQDNs", () => {
    expect(normalizeHostKey("Office.tailnet-example.ts.net")).toBe("office");
    expect(normalizeHostKey("pi-server")).toBe("pi-server");
  });

  it("keeps IPv4 addresses verbatim", () => {
    expect(normalizeHostKey("100.64.0.13")).toBe("100.64.0.13");
  });
});

describe("parseTailscaleStatus", () => {
  it("matches by bare hostname, FQDN, and Tailscale IP", () => {
    const servers = parseTailscaleStatus(STATUS, [
      { host: "pi-server", alias: "Garage" },
      { host: "nas.tailnet-example.ts.net", alias: "NAS" },
      { host: "100.64.0.13", alias: "GPU box" },
    ]);
    expect(servers).toHaveLength(3);
    expect(servers[0]).toMatchObject({ alias: "Garage", online: true, found: true, os: "linux" });
    expect(servers[1]).toMatchObject({ alias: "NAS", online: false, found: true });
    expect(servers[2]).toMatchObject({ alias: "GPU box", online: true, found: true });
  });

  it("reports lastSeen for offline peers and null for the zero timestamp", () => {
    const servers = parseTailscaleStatus(STATUS, [
      { host: "pi-server" },
      { host: "nas" },
    ]);
    expect(servers[0].lastSeen).toBeNull();
    expect(servers[1].lastSeen).toBe(Math.floor(Date.parse("2026-02-25T10:00:00Z") / 1000));
  });

  it("includes Self in matching", () => {
    const [self] = parseTailscaleStatus(STATUS, [{ host: "laptop" }]);
    expect(self).toMatchObject({ online: true, found: true, os: "macOS" });
  });

  it("marks unknown hosts as not found and offline", () => {
    const [ghost] = parseTailscaleStatus(STATUS, [{ host: "no-such-box", alias: "Ghost" }]);
    expect(ghost).toMatchObject({ alias: "Ghost", online: false, found: false, lastSeen: null });
  });

  it("falls back to host for the alias", () => {
    const [s] = parseTailscaleStatus(STATUS, [{ host: "pi-server" }]);
    expect(s.alias).toBe("pi-server");
  });

  it("tolerates malformed status output", () => {
    expect(parseTailscaleStatus(null, [{ host: "pi-server" }])[0].found).toBe(false);
    expect(parseTailscaleStatus({ Peer: "nope" }, [{ host: "pi-server" }])[0].found).toBe(false);
    expect(parseTailscaleStatus({ Peer: { k: { DNSName: 5, Online: "yes" } } }, [{ host: "pi-server" }])[0].found).toBe(false);
  });
});
