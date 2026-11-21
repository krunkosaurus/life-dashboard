import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/claude-usage.json";

// Exercise caching without reading or rotating the machine's real credentials.
// Each profile folder holds its own login; a "nocreds" folder holds none.
const writeFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ default: {
  readFileSync: (file: string) => {
    if (file.endsWith(".credentials.json") && !file.includes("nocreds")) {
      // The ".claude-expired" profile's login ran out an hour before the test clock.
      const expired = file.includes(".claude-expired");
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: expired ? "expired-only" : file.includes(".claude-personal") ? "personal-only" : "test-only",
          refreshToken: expired ? "expired-refresh" : "test-only-refresh",
          expiresAt: Date.parse(expired ? "2026-09-23T04:00:00Z" : "2026-09-23T06:00:00Z"),
        },
      });
    }
    throw new Error("No test file");
  },
  mkdirSync: vi.fn(), writeFileSync,
} }));
// A stand-in login Keychain: tests add items, and `security -i` writes land
// here instead of the machine's real Keychain.
const keychain = vi.hoisted(() => ({ items: new Map<string, string>(), inputs: [] as string[] }));
vi.mock("node:child_process", () => ({
  execFileSync: (command: string, args: string[] = [], opts: { input?: string } = {}) => {
    if (command === "claude") return "2.1.280";
    if (command === "security" && args[0] === "find-generic-password") {
      const item = keychain.items.get(args[args.indexOf("-s") + 1]);
      if (item !== undefined) return item;
    }
    if (command === "security" && args[0] === "-i" && opts.input) {
      keychain.inputs.push(opts.input);
      const m = opts.input.match(/-s "([^"]+)" -X "([0-9a-f]+)"/);
      if (m) keychain.items.set(m[1], Buffer.from(m[2], "hex").toString("utf8"));
      return "";
    }
    throw new Error("No test Keychain");
  },
}));

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  vi.resetModules(); writeFileSync.mockClear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T05:00:00Z"));
  keychain.items.clear(); keychain.inputs.length = 0;
  // The Keychain is macOS-only; run its code path wherever the tests run.
  Object.defineProperty(process, "platform", { ...realPlatform, value: "darwin" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Object.defineProperty(process, "platform", realPlatform); });

function success() {
  return new Response(JSON.stringify(fixture), { status: 200 });
}

describe("manual Claude reset checks", () => {
  it("refreshes a successful cache on demand while suppressing rapid repeated checks", async () => {
    const fetchMock = vi.fn().mockImplementation(success);
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");
    await fetchClaudeUsage();
    await fetchClaudeUsage({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    await fetchClaudeUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchClaudeUsage({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a manual check bypass Retry-After", async () => {
    // Fixed credentials ensure time passing is not mistaken for token rotation.
    const fetchMock = vi.fn().mockImplementation(() => new Response("", {
      status: 429, headers: { "Retry-After": "120" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");
    await fetchClaudeUsage();
    vi.advanceTimersByTime(30_000);
    await fetchClaudeUsage({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares the manual request with a concurrent normal poll", async () => {
    const fetchMock = vi.fn().mockImplementation(success);
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");
    await fetchClaudeUsage();
    vi.advanceTimersByTime(15_000);
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const manual = fetchClaudeUsage({ forceRefresh: true });
    const poll = fetchClaudeUsage();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolve(new Response(JSON.stringify({ ...fixture, cedar_ember: { eligible: true, grants: [] } })));
    expect(await poll).toBe(await manual);
    expect(await poll).toMatchObject({ bonusResets: { state: "known", grants: [] } });
  });
});

describe("multiple Claude accounts", () => {
  const personal = { id: "personal", label: "P", configDir: "/Users/test/.claude-personal" };
  const authorization = (call: unknown[]) =>
    ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
  const profileHash = (dir: string) => createHash("sha256").update(dir).digest("hex").slice(0, 8);

  it("uses each account's own token, cache and last-good file", async () => {
    const fetchMock = vi.fn().mockImplementation(success);
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");
    await fetchClaudeUsage();
    await fetchClaudeUsage({ account: personal });
    await fetchClaudeUsage();
    await fetchClaudeUsage({ account: personal });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorization(fetchMock.mock.calls[0])).toBe("Bearer test-only");
    expect(authorization(fetchMock.mock.calls[1])).toBe("Bearer personal-only");
    const written = writeFileSync.mock.calls.map(call => String(call[0]));
    expect(written.some(file => file.endsWith("claude-last-good.json"))).toBe(true);
    expect(written.some(file => file.endsWith(`claude-last-good-${profileHash(personal.configDir)}.json`))).toBe(true);
  });

  it("refreshes an expired login with that account's own refresh token and caches it for that account only", async () => {
    const idle = { id: "idle", label: "I", configDir: "/Users/test/.claude-expired" };
    const fetchMock = vi.fn().mockImplementation((url: string) => String(url).includes("/oauth/token")
      ? new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600 }), { status: 200 })
      : success());
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");
    const result = await fetchClaudeUsage({ account: idle });
    expect(result.ok).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).refresh_token).toBe("expired-refresh");
    expect(authorization(fetchMock.mock.calls[1])).toBe("Bearer rotated");
    const written = writeFileSync.mock.calls.map(call => String(call[0]));
    expect(written.some(file => file.includes(`claude-oauth-${profileHash(idle.configDir)}.json`))).toBe(true);
    // Never the default account's token cache.
    expect(written.some(file => file.includes("claude-oauth.json"))).toBe(false);
    // No Keychain item for this profile, so none is created.
    expect(keychain.inputs).toHaveLength(0);
  });

  it("writes a rotated login back to that profile's Claude Code Keychain item, keeping its other fields", async () => {
    // Refresh tokens rotate, so a refresh the CLI never sees would log it out.
    const idle = { id: "idle", label: "I", configDir: "/Users/test/.claude-expired" };
    const service = `Claude Code-credentials-${profileHash(idle.configDir)}`;
    const login = {
      accessToken: "keychain-expired",
      refreshToken: "keychain-refresh",
      expiresAt: Date.parse("2026-09-23T04:30:00Z"),
      refreshTokenExpiresAt: 1_800_000_000_000,
      scopes: ["user:inference", "user:plugins"],
      subscriptionType: "max",
    };
    keychain.items.set(service, JSON.stringify({ claudeAiOauth: login }));
    const fetchMock = vi.fn().mockImplementation((url: string) => String(url).includes("/oauth/token")
      ? new Response(JSON.stringify({
        access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600, scope: "user:inference user:plugins",
      }), { status: 200 })
      : success());
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClaudeUsage } = await import("../claude");

    expect((await fetchClaudeUsage({ account: idle })).ok).toBe(true);

    // The Keychain login is fresher than the file, and its own scopes are
    // requested, as Claude Code does.
    const refreshBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(refreshBody.refresh_token).toBe("keychain-refresh");
    expect(refreshBody.scope).toBe("user:inference user:plugins");
    expect(keychain.inputs).toHaveLength(1);
    expect(keychain.inputs[0]).toMatch(new RegExp(`^add-generic-password -U -a "[^"]+" -s "${service}" -X "[0-9a-f]+"\\n$`));
    expect(JSON.parse(keychain.items.get(service)!)).toEqual({ claudeAiOauth: {
      ...login,
      accessToken: "rotated",
      refreshToken: "rotated-refresh",
      expiresAt: Date.parse("2026-09-23T06:00:00Z"),
    } });
  });

  it("keeps one account's rate limit from blocking the other", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization === "Bearer test-only"
        ? new Response("", { status: 429, headers: { "Retry-After": "120" } })
        : success());
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAllClaudeUsage } = await import("../claude");
    const all = await fetchAllClaudeUsage([{ id: "default", label: "Claude Code" }, personal]);
    errorSpy.mockRestore();
    expect(all.map(a => [a.id, a.label, a.usage.ok])).toEqual([
      ["default", "Claude Code", false],
      ["personal", "P", true],
    ]);
  });

  it("reports a missing login without naming the profile folder or Keychain item", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
    const { fetchClaudeUsage } = await import("../claude");
    const result = await fetchClaudeUsage({
      account: { id: "ghost", label: "G", configDir: "/Users/test/.claude-ghost-nocreds" },
    });
    const logged = errorSpy.mock.calls.map(call => String(call[0])).join("\n");
    errorSpy.mockRestore();
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("CLAUDE_CONFIG_DIR");
    expect(result.error).not.toContain(".claude-ghost");
    expect(result.error).not.toContain("Claude Code-credentials");
    // The detail needed to diagnose it stays in the server log.
    expect(logged).toMatch(/Claude Code-credentials-[0-9a-f]{8}/);
    expect(logged).toContain("/Users/test/.claude-ghost-nocreds/.credentials.json");
  });
});
