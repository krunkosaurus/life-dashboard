import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  addressFromPrivateKey,
  applyVariants,
  decodeJwtExp,
  deriveWalletKey,
  extractStats,
  formatStatValue,
  getLiveLog,
  mergeEvents,
  normalizeSourceRows,
  parseTime,
  personalSign,
  renderTemplate,
  resetLiveLogStateForTests,
  resolveBadges,
  resolvePath,
  signTypedData,
  substituteTokens,
} from "../livelog";
import { parseConfig } from "../config";
import type { LiveLogConfig, LiveLogSourceInput } from "../types";

vi.mock("../config", async importOriginal => {
  const original = await importOriginal<typeof import("../config")>();
  return { ...original, loadConfig: vi.fn(original.loadConfig) };
});
import { loadConfig } from "../config";

const NOW = new Date("2026-07-20T10:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

// Well-known public test key (hardhat account #1) — never a real credential.
const TEST_PK = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_ADDR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

// Independently generated with ethers v6: new Wallet(pbkdf2(toUtf8Bytes(
// "testuser" + "hunter2-example"), toUtf8Bytes("example-salt"), 10000, 32, "sha256")).
const VECTOR_PK = "0x25a59135824466afe7bfef445d73dba43c1b1f602530da0ccf71dd8c01395b40";
const VECTOR_ADDR = "0x9E8A55D596A752f6A5DF34e0ea7135903C7585aE";
const VECTOR_EIP712_SIG =
  "0x8764bfb8b9ffc7b5445ef267f14505fd8dfc48773189fffbddd3de41f4241e6c3d0d3d5faa75e747411de87dce9370d0c69990d07c25f425c42a6a8719d76b721c";

function makeSource(overrides: Partial<LiveLogSourceInput> = {}): LiveLogSourceInput {
  return {
    id: "signups",
    label: "Signup",
    api: "https://api.example.com/items",
    itemsPath: "data.items",
    time: "created",
    ...overrides,
  };
}

describe("substituteTokens", () => {
  it("expands the fixed tokens in UTC", () => {
    expect(substituteTokens("${today}", NOW)).toBe("2026-07-20");
    expect(substituteTokens("${yesterday}", NOW)).toBe("2026-07-19");
    expect(substituteTokens("${ymdDaysAgo:3}", NOW)).toBe("2026-07-17");
    expect(substituteTokens("${isoDaysAgo:1}", NOW)).toBe("2026-07-19T10:00:00.000Z");
    expect(substituteTokens("${epochDaysAgo:2}", NOW)).toBe(String(NOW_S - 2 * 86400));
    expect(substituteTokens("${nowIso}", NOW)).toBe("2026-07-20T10:00:00.000Z");
  });

  it("substitutes inside longer strings and leaves unknown tokens alone", () => {
    expect(substituteTokens("from=${yesterday}&x=${bogus}", NOW)).toBe("from=2026-07-19&x=${bogus}");
  });
});

describe("resolvePath", () => {
  const obj = {
    data: {
      total: { count: 7 },
      byTerm: [
        { term: "monthly", count: 12 },
        { term: "annual", count: 3 },
      ],
      items: ["a", "b"],
    },
  };

  it("walks dotted paths", () => {
    expect(resolvePath(obj, "data.total.count")).toBe(7);
  });

  it("supports [key=value] array selectors", () => {
    expect(resolvePath(obj, "data.byTerm[term=annual].count")).toBe(3);
    expect(resolvePath(obj, "data.byTerm[term=weekly].count")).toBeUndefined();
  });

  it("supports numeric indexes and returns undefined on misses", () => {
    expect(resolvePath(obj, "data.items.1")).toBe("b");
    expect(resolvePath(obj, "data.missing.deep")).toBeUndefined();
    expect(resolvePath(null, "a")).toBeUndefined();
  });
});

describe("parseTime", () => {
  it("auto-detects seconds, milliseconds and ISO strings", () => {
    expect(parseTime(1_752_998_400)).toBe(1_752_998_400);
    expect(parseTime(1_752_998_400_000)).toBe(1_752_998_400);
    expect(parseTime("1752998400")).toBe(1_752_998_400);
    expect(parseTime("2026-07-20T08:00:00.000Z")).toBe(Date.parse("2026-07-20T08:00:00.000Z") / 1000);
  });

  it("rejects garbage", () => {
    expect(parseTime("soon")).toBeNull();
    expect(parseTime(42)).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe("renderTemplate", () => {
  it("fills fields, localizes numbers and supports dotted paths", () => {
    expect(renderTemplate("{user} paid {amount}", { user: "ada", amount: 1234.5 })).toBe("ada paid 1,234.5");
    expect(renderTemplate("{meta.app}", { meta: { app: "web" } })).toBe("web");
  });

  it("drops separator parts left empty or without letters/digits", () => {
    expect(renderTemplate("{email} · {country} · {app}", { email: "a@b.c", app: "web" })).toBe("a@b.c · web");
    expect(renderTemplate("${amount} · {tokens}⚡", { tokens: 5000 })).toBe("5,000⚡");
    expect(renderTemplate("{missing}", {})).toBe("");
  });
});

describe("applyVariants / resolveBadges", () => {
  const source = makeSource({
    color: "#111111",
    variants: [
      { when: { field: "status", equals: "trialing" }, label: "Trial started", color: "#f59e0b" },
      { when: { field: "trialEnd", nonNull: true }, label: "Converted" },
    ],
    badges: [
      { field: "term", map: { monthly: "Monthly", annual: "Annual" }, color: "#7aa2f7" },
      { field: "provider" },
    ],
  });

  it("first matching variant wins; defaults otherwise", () => {
    expect(applyVariants(source, { status: "trialing", trialEnd: "x" }, "#000")).toEqual({
      label: "Trial started",
      color: "#f59e0b",
    });
    expect(applyVariants(source, { status: "active", trialEnd: "x" }, "#000")).toEqual({
      label: "Converted",
      color: "#111111",
    });
    expect(applyVariants(source, { status: "active" }, "#000")).toEqual({ label: "Signup", color: "#111111" });
  });

  it("maps badge values, skips unmapped and missing fields, shows raw without a map", () => {
    expect(resolveBadges(source, { term: "monthly", provider: "stripe" })).toEqual([
      { text: "Monthly", color: "#7aa2f7" },
      { text: "stripe" },
    ]);
    expect(resolveBadges(source, { term: "weekly" })).toEqual([]);
    expect(resolveBadges(source, {})).toEqual([]);
  });
});

describe("normalizeSourceRows", () => {
  const source = makeSource({ title: "{user}", detail: "{email}", windowHours: 48, limit: 3 });

  it("windows, sorts desc, caps and falls back to the label for empty titles", () => {
    const rows = [
      { user: "old", created: NOW_S - 50 * 3600 },          // outside window
      { user: "future", created: NOW_S + 3600 },            // future -> dropped
      { user: "b", created: NOW_S - 7200, email: "b@x.co" },
      { user: "a", created: NOW_S - 60 },
      { created: NOW_S - 120 },                             // no title -> label
      { user: "d", created: NOW_S - 300 },
      "not-an-object",
    ];
    const events = normalizeSourceRows(source, rows, NOW, 48);
    expect(events.map(e => e.title)).toEqual(["a", "Signup", "d"]); // capped at 3
    expect(events[0].detail).toBeUndefined();
    expect(new Set(events.map(e => e.id)).size).toBe(3);
  });

  it("uses the feed-wide window when the source has none", () => {
    const src = makeSource();
    const events = normalizeSourceRows(src, [{ created: NOW_S - 3 * 3600 }], NOW, 2);
    expect(events).toEqual([]);
  });
});

describe("mergeEvents / stats formatting", () => {
  it("interleaves by time desc and caps", () => {
    const mk = (id: string, time: number) => ({
      id, sourceId: "s", label: "L", color: "#fff", time, title: id, badges: [],
    });
    const merged = mergeEvents([[mk("a", 100), mk("b", 300)], [mk("c", 200)]], 2);
    expect(merged.map(e => e.id)).toEqual(["b", "c"]);
  });

  it("formats numbers, usd, percents and misses", () => {
    expect(formatStatValue(1234)).toBe("1,234");
    expect(formatStatValue(318.4, "usd")).toBe("$318.40");
    expect(formatStatValue(318, "usd")).toBe("$318");
    expect(formatStatValue(0.182, "percent")).toBe("18.2%");
    expect(formatStatValue(18.2, "percent")).toBe("18.2%");
    expect(formatStatValue(undefined)).toBe("—");
    expect(formatStatValue("n/a")).toBe("n/a");
  });

  it("extracts stats via paths", () => {
    const group = {
      api: "https://api.example.com/metrics",
      items: [
        { label: "Active", path: "data.activeCount" },
        { label: "Missing", path: "data.nope" },
      ],
    };
    expect(extractStats(group, { data: { activeCount: 9 } })).toEqual([
      { label: "Active", value: "9" },
      { label: "Missing", value: "—" },
    ]);
  });
});

describe("personalSign / decodeJwtExp", () => {
  it("produces a recoverable EIP-191 signature", () => {
    const sig = personalSign("nonce-123", `0x${TEST_PK}`);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    const v = parseInt(sig.slice(-2), 16);
    expect([27, 28]).toContain(v);
    // Recover the signer address and compare with the key's address.
    const msg = "nonce-123";
    const hash = keccak_256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}${msg}`));
    const parsed = secp256k1.Signature.fromBytes(
      hexToBytes(`0${v - 27}`.slice(-2) + sig.slice(2, -2)),
      "recovered"
    );
    const pub = parsed.recoverPublicKey(hash).toBytes(false);
    expect(`0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`).toBe(TEST_ADDR);
  });

  it("rejects malformed keys without echoing them", () => {
    expect(() => personalSign("m", "not-hex")).toThrow(/32-byte hex/);
  });

  it("decodes exp from a JWT payload and tolerates junk", () => {
    const payload = Buffer.from(JSON.stringify({ addr: TEST_ADDR, exp: 1_800_000_000 })).toString("base64url");
    expect(decodeJwtExp(`x.${payload}.y`)).toBe(1_800_000_000);
    expect(decodeJwtExp("nope")).toBeNull();
    expect(decodeJwtExp("a.###.c")).toBeNull();
  });
});

describe("wallet derivation + EIP-712 (vectors generated with ethers v6)", () => {
  it("derives the same key as ethers pbkdf2 and lowercases the username by default", () => {
    const derive = { salt: "example-salt", iterations: 10000 };
    expect(deriveWalletKey("TestUser", "hunter2-example", derive)).toBe(VECTOR_PK);
    expect(deriveWalletKey("testuser", "hunter2-example", derive)).toBe(VECTOR_PK);
    expect(deriveWalletKey("TestUser", "hunter2-example", { ...derive, lowercaseUsername: false })).not.toBe(VECTOR_PK);
  });

  it("derives the EIP-55 checksummed address", () => {
    expect(addressFromPrivateKey(VECTOR_PK)).toBe(VECTOR_ADDR);
  });

  it("produces the same EIP-712 signature as ethers signTypedData", () => {
    const sig = signTypedData(
      {
        scheme: "eip712",
        domain: {
          name: "Example App",
          version: "1",
          chainId: "8453",
          verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
        },
        primaryType: "Authentication",
        types: {
          Authentication: [
            { name: "walletAddress", type: "address" },
            { name: "nonce", type: "string" },
          ],
        },
        message: {},
      },
      { walletAddress: VECTOR_ADDR, nonce: "nonce-abc-123" },
      VECTOR_PK
    );
    expect(sig).toBe(VECTOR_EIP712_SIG);
  });

  it("rejects unsupported field types", () => {
    expect(() =>
      signTypedData(
        {
          scheme: "eip712",
          domain: { name: "X" },
          primaryType: "T",
          types: { T: [{ name: "b", type: "bytes32" }] },
          message: {},
        },
        { b: "0x00" },
        VECTOR_PK
      )
    ).toThrow(/unsupported/);
  });
});

describe("parseConfig liveLog block", () => {
  it("parses a full block and applies defaults", () => {
    const cfg = parseConfig(
      {
        liveLog: {
          title: "Pulse",
          auth: {
            type: "walletSign",
            nonceUrl: "https://api.example.com/nonce",
            loginUrl: "https://api.example.com/login",
            walletAddress: TEST_ADDR,
            privateKeyEnv: "TEST_LIVELOG_PK",
            origin: "https://admin.example.com",
            extraBody: { appSource: "dash" },
          },
          stats: [
            {
              api: "https://api.example.com/metrics",
              items: [{ label: "Active", path: "data.activeCount", format: "usd" }, { label: "", path: "x" }],
            },
          ],
          sources: [
            {
              id: "s1", label: "Signup", api: "https://api.example.com/new",
              itemsPath: "data.items", time: "created",
              badges: [{ field: "term", map: { monthly: "Monthly" } }],
              variants: [{ when: { field: "status", equals: "trialing" }, label: "Trial" }],
              limit: 10.7,
            },
            { id: "broken" },
          ],
        },
      },
      {}
    );
    expect(cfg.liveLog).not.toBeNull();
    expect(cfg.liveLog?.title).toBe("Pulse");
    expect(cfg.liveLog?.windowHours).toBe(48);
    expect(cfg.liveLog?.maxItems).toBe(60);
    expect(cfg.liveLog?.auth?.walletAddress).toBe(TEST_ADDR);
    expect(cfg.liveLog?.stats[0].items).toHaveLength(1);
    expect(cfg.liveLog?.sources).toHaveLength(1);
    expect(cfg.liveLog?.sources[0].limit).toBe(10);
  });

  it("returns null for absent, malformed or empty blocks", () => {
    expect(parseConfig({}, {}).liveLog).toBeNull();
    expect(parseConfig({ liveLog: "yes" }, {}).liveLog).toBeNull();
    expect(parseConfig({ liveLog: { sources: [{ id: "x" }] } }, {}).liveLog).toBeNull();
  });

  it("drops auth blocks missing required fields", () => {
    const cfg = parseConfig(
      {
        liveLog: {
          auth: { type: "walletSign", nonceUrl: "https://x/n" },
          sources: [{ id: "s", label: "L", api: "https://x/a", itemsPath: "data", time: "t" }],
        },
      },
      {}
    );
    expect(cfg.liveLog?.auth).toBeNull();
  });

  it("parses credential-derived auth with an EIP-712 signature scheme", () => {
    const cfg = parseConfig(
      {
        liveLog: {
          auth: {
            type: "walletSign",
            nonceUrl: "https://api.example.com/nonce",
            loginUrl: "https://api.example.com/login",
            derive: { usernameEnv: "LL_USER", passwordEnv: "LL_PASS", salt: "example-salt", iterations: 10000 },
            signature: {
              scheme: "eip712",
              domain: { name: "Example App", version: "1", chainId: "8453" },
              primaryType: "Authentication",
              types: { Authentication: [{ name: "walletAddress", type: "address" }, { name: "nonce", type: "string" }] },
              message: { walletAddress: "${walletAddress}", nonce: "${nonce}" },
            },
          },
          sources: [{ id: "s", label: "L", api: "https://x/a", itemsPath: "data", time: "t" }],
        },
      },
      {}
    );
    const auth = cfg.liveLog?.auth;
    expect(auth?.derive).toMatchObject({ usernameEnv: "LL_USER", salt: "example-salt" });
    expect(auth?.walletAddress).toBeUndefined();
    expect(auth?.signature).toMatchObject({ scheme: "eip712", primaryType: "Authentication" });
    // Malformed signature blocks fall back to the personal_sign default (absent).
    const broken = parseConfig(
      {
        liveLog: {
          auth: {
            type: "walletSign", nonceUrl: "https://x/n", loginUrl: "https://x/l",
            derive: { usernameEnv: "U", passwordEnv: "P", salt: "s" },
            signature: { scheme: "eip712", primaryType: "T" },
          },
          sources: [{ id: "s", label: "L", api: "https://x/a", itemsPath: "data", time: "t" }],
        },
      },
      {}
    );
    expect(broken.liveLog?.auth?.signature).toBeUndefined();
  });
});

describe("getLiveLog (integration, stubbed fetch)", () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  const jwt = (expiresAt: number) =>
    `h.${Buffer.from(JSON.stringify({ addr: TEST_ADDR, exp: expiresAt })).toString("base64url")}.s`;

  function liveLogConfig(overrides: Partial<LiveLogConfig> = {}): LiveLogConfig {
    return {
      title: "Pulse",
      windowHours: 48,
      maxItems: 60,
      auth: {
        type: "walletSign",
        nonceUrl: "https://api.example.com/nonce",
        loginUrl: "https://api.example.com/login",
        walletAddress: TEST_ADDR,
        privateKeyEnv: "TEST_LIVELOG_PK",
        origin: "https://admin.example.com",
        extraBody: { appSource: "dash" },
      },
      stats: [
        {
          api: "https://api.example.com/metrics",
          items: [{ label: "Active", path: "data.activeCount" }],
        },
      ],
      sources: [
        makeSource({ id: "signups", title: "{user}", params: { date: "${today}" } }),
        makeSource({ id: "buys", label: "Purchase", api: "https://api.example.com/buys", title: "{user}" }),
      ],
      ...overrides,
    };
  }

  function stubFetch(handlers: Record<string, (url: string, init?: RequestInit) => { status?: number; body: unknown }>) {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = Object.keys(handlers).find(k => url.startsWith(k));
      if (!key) throw new Error(`unhandled fetch: ${url}`);
      const { status = 200, body } = handlers[key](url, init);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    resetLiveLogStateForTests();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "livelog-test-"));
    process.env.LIVELOG_CACHE_DIR = tmpDir;
    process.env.TEST_LIVELOG_PK = TEST_PK;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(loadConfig).mockReset();
    delete process.env.LIVELOG_CACHE_DIR;
    delete process.env.TEST_LIVELOG_PK;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockConfig(liveLog: LiveLogConfig | null) {
    vi.mocked(loadConfig).mockReturnValue({
      icsUrl: null, manualEvents: [], birthdays: [], pinnedEvents: [], refreshSeconds: 60,
      life: null, tailscaleHosts: [], analytics: null, checklists: null, liveLog,
    });
  }

  it("hides when unconfigured", async () => {
    mockConfig(null);
    const result = await getLiveLog(NOW);
    expect(result).toMatchObject({ ok: false, hidden: true });
  });

  it("logs in once, sends bearer + origin, merges sources and extracts stats", async () => {
    mockConfig(liveLogConfig());
    stubFetch({
      "https://api.example.com/nonce": () => ({ body: { status: "success", data: { nonce: "n-1" } } }),
      "https://api.example.com/login": (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.walletAddress).toBe(TEST_ADDR);
        expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
        expect(body.rememberMe).toBe(true);
        expect(body.appSource).toBe("dash");
        return { body: { status: "success", data: { token: jwt(NOW_S + 86400) } } };
      },
      "https://api.example.com/items": url => {
        expect(url).toContain("date=2026-07-20");
        return { body: { data: { items: [{ user: "ada", created: NOW_S - 120 }] } } };
      },
      "https://api.example.com/buys": () => ({
        body: { data: { items: [{ user: "bob", created: NOW_S - 60 }] } },
      }),
      "https://api.example.com/metrics": () => ({ body: { data: { activeCount: 41 } } }),
    });

    const result = await getLiveLog(NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map(e => e.title)).toEqual(["bob", "ada"]);
    expect(result.stats).toEqual([{ label: "Active", value: "41" }]);
    expect(result.sourceErrors).toEqual([]);
    expect(result.stale).toBeUndefined();

    // Every data request carried the bearer token and origin headers.
    const dataCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/items") || String(u).includes("/buys") || String(u).includes("/metrics"));
    for (const [, init] of dataCalls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^Bearer h\./);
      expect(headers.origin).toBe("https://admin.example.com");
    }
    // One nonce + one login for the whole batch.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/nonce"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/login"))).toHaveLength(1);
  });

  it("serves cached sources within the TTL without refetching", async () => {
    mockConfig(liveLogConfig({ stats: [] }));
    stubFetch({
      "https://api.example.com/nonce": () => ({ body: { data: { nonce: "n" } } }),
      "https://api.example.com/login": () => ({ body: { data: { token: jwt(NOW_S + 86400) } } }),
      "https://api.example.com/items": () => ({ body: { data: { items: [{ user: "ada", created: NOW_S - 120 }] } } }),
      "https://api.example.com/buys": () => ({ body: { data: { items: [] } } }),
    });
    await getLiveLog(NOW);
    const callsAfterFirst = fetchMock.mock.calls.length;
    const again = await getLiveLog(new Date(NOW.getTime() + 30_000));
    expect(again.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // all cache hits
  });

  it("surfaces per-source errors while other sources still render", async () => {
    mockConfig(liveLogConfig({ stats: [] }));
    stubFetch({
      "https://api.example.com/nonce": () => ({ body: { data: { nonce: "n" } } }),
      "https://api.example.com/login": () => ({ body: { data: { token: jwt(NOW_S + 86400) } } }),
      "https://api.example.com/items": () => ({ body: { data: { items: [{ user: "ada", created: NOW_S - 120 }] } } }),
      "https://api.example.com/buys": () => ({ status: 500, body: { message: "boom" } }),
    });
    const result = await getLiveLog(NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map(e => e.title)).toEqual(["ada"]);
    expect(result.sourceErrors).toHaveLength(1);
    expect(result.sourceErrors[0]).toMatchObject({ id: "buys" });
    expect(result.sourceErrors[0].error).toContain("HTTP 500");
    expect(result.failures?.length).toBeGreaterThan(0);
  });

  it("logs in with derived credentials and an EIP-712 signature", async () => {
    process.env.TEST_LIVELOG_USER = "TestUser";
    process.env.TEST_LIVELOG_PASS = "hunter2-example";
    mockConfig(
      liveLogConfig({
        stats: [],
        sources: [makeSource({ id: "signups", title: "{user}" })],
        auth: {
          type: "walletSign",
          nonceUrl: "https://api.example.com/nonce",
          loginUrl: "https://api.example.com/login",
          derive: { usernameEnv: "TEST_LIVELOG_USER", passwordEnv: "TEST_LIVELOG_PASS", salt: "example-salt", iterations: 10000 },
          signature: {
            scheme: "eip712",
            domain: {
              name: "Example App",
              version: "1",
              chainId: "8453",
              verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
            },
            primaryType: "Authentication",
            types: {
              Authentication: [
                { name: "walletAddress", type: "address" },
                { name: "nonce", type: "string" },
              ],
            },
            message: { walletAddress: "${walletAddress}", nonce: "${nonce}" },
          },
        },
      })
    );
    stubFetch({
      "https://api.example.com/nonce": (_url, init) => {
        expect(JSON.parse(String(init?.body)).walletAddress).toBe(VECTOR_ADDR);
        return { body: { data: { nonce: "nonce-abc-123" } } };
      },
      "https://api.example.com/login": (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.walletAddress).toBe(VECTOR_ADDR);
        expect(body.signature).toBe(VECTOR_EIP712_SIG); // exact ethers-generated vector
        return { body: { data: { token: jwt(NOW_S + 86400) } } };
      },
      "https://api.example.com/items": () => ({ body: { data: { items: [{ user: "ada", created: NOW_S - 5 }] } } }),
    });
    const result = await getLiveLog(NOW);
    delete process.env.TEST_LIVELOG_USER;
    delete process.env.TEST_LIVELOG_PASS;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
  });

  it("relogs in and retries once on 401", async () => {
    mockConfig(liveLogConfig({ stats: [], sources: [makeSource({ id: "signups", title: "{user}" })] }));
    let tokenServed = 0;
    let itemCalls = 0;
    stubFetch({
      "https://api.example.com/nonce": () => ({ body: { data: { nonce: "n" } } }),
      "https://api.example.com/login": () => {
        tokenServed++;
        return { body: { data: { token: jwt(NOW_S + 86400) } } };
      },
      "https://api.example.com/items": () => {
        itemCalls++;
        if (itemCalls === 1) return { status: 401, body: { message: "expired" } };
        return { body: { data: { items: [{ user: "ada", created: NOW_S - 10 }] } } };
      },
    });
    const result = await getLiveLog(NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(tokenServed).toBe(2);
    expect(itemCalls).toBe(2);
  });

  it("falls back to the last-good snapshot when everything fails", async () => {
    mockConfig(liveLogConfig({ stats: [] }));
    stubFetch({
      "https://api.example.com/nonce": () => ({ body: { data: { nonce: "n" } } }),
      "https://api.example.com/login": () => ({ body: { data: { token: jwt(NOW_S + 86400) } } }),
      "https://api.example.com/items": () => ({ body: { data: { items: [{ user: "ada", created: NOW_S - 120 }] } } }),
      "https://api.example.com/buys": () => ({ body: { data: { items: [{ user: "bob", created: NOW_S - 60 }] } } }),
    });
    const first = await getLiveLog(NOW);
    expect(first.ok).toBe(true);

    // Fresh process: only the disk snapshot survives; the API is now down.
    resetLiveLogStateForTests();
    stubFetch({
      "https://api.example.com/": () => ({ status: 503, body: { message: "down" } }),
    });
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const result = await getLiveLog(later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stale).toBe(true);
    expect(result.events.map(e => e.title)).toEqual(["bob", "ada"]);
    expect(result.staleReason).toBeTruthy();
  });

  it("reports a clean error when the signing key env is missing", async () => {
    delete process.env.TEST_LIVELOG_PK;
    mockConfig(liveLogConfig({ stats: [] }));
    stubFetch({});
    const result = await getLiveLog(NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("TEST_LIVELOG_PK");
    expect(result.error).not.toContain(TEST_PK);
  });
});
