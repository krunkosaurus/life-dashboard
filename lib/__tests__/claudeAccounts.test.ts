import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  claudeAccountFiles,
  claudeKeychainService,
  findClaudeAccount,
  parseClaudeAccounts,
} from "../claudeAccounts";

const HOME = "/Users/test";

describe("parseClaudeAccounts", () => {
  it("falls back to one default account", () => {
    for (const input of [undefined, null, "x", [], [{ label: "no id" }]]) {
      expect(parseClaudeAccounts(input, HOME)).toEqual([{ id: "default", label: "Claude Code" }]);
    }
  });

  it("parses a default-profile and a profile account", () => {
    expect(parseClaudeAccounts([
      { id: "sogni", label: " Claude · sogni " },
      { id: "personal", configDir: "~/.claude-personal/" },
    ], HOME)).toEqual([
      { id: "sogni", label: "Claude · sogni" },
      { id: "personal", label: "personal", configDir: "/Users/test/.claude-personal" },
    ]);
  });

  it("drops an entry with a malformed configDir instead of using the default profile", () => {
    for (const configDir of [42, "", "  ", "relative/dir", null]) {
      // Nothing else occupies the default profile here, so an entry that fell
      // back to it would survive and show up in the result.
      expect(parseClaudeAccounts([{ id: "b", configDir }], HOME)).toEqual([{ id: "default", label: "Claude Code" }]);
      expect(parseClaudeAccounts([{ id: "a", configDir: "/a" }, { id: "b", configDir }], HOME))
        .toEqual([{ id: "a", label: "a", configDir: "/a" }]);
    }
  });

  it("keeps the first of duplicate ids and of entries sharing a profile", () => {
    expect(parseClaudeAccounts([
      { id: "a" }, { id: "a", configDir: "/x" }, { id: "b" },
      { id: "c", configDir: "/y" }, { id: "d", configDir: "/y/" },
      { id: "bad id" },
    ], HOME).map(a => a.id)).toEqual(["a", "c"]);
  });
});

describe("findClaudeAccount", () => {
  const accounts = [{ id: "sogni", label: "S" }, { id: "personal", label: "P", configDir: "/p" }];

  it("answers for the default profile when no id is given, wherever it is listed", () => {
    expect(findClaudeAccount(accounts, null)).toBe(accounts[0]);
    expect(findClaudeAccount(accounts, "")).toBe(accounts[0]);
    // Display order is the config order; reordering must not change which
    // account the unparameterized route answers for.
    const reordered = [accounts[1], accounts[0]];
    expect(findClaudeAccount(reordered, null)).toBe(accounts[0]);
    expect(findClaudeAccount(reordered, "")).toBe(accounts[0]);
  });

  it("falls back to the first account when none uses the default profile", () => {
    const profiles = [{ id: "a", label: "A", configDir: "/a" }, { id: "b", label: "B", configDir: "/b" }];
    expect(findClaudeAccount(profiles, null)).toBe(profiles[0]);
  });

  it("finds by id and rejects unknown ids", () => {
    expect(findClaudeAccount(accounts, "personal")).toBe(accounts[1]);
    expect(findClaudeAccount(accounts, "nope")).toBeUndefined();
  });
});

describe("claudeKeychainService", () => {
  it("uses Claude Code's default item for the default profile", () => {
    expect(claudeKeychainService()).toBe("Claude Code-credentials");
  });

  it("suffixes the first 8 hex chars of sha256(configDir)", () => {
    const dir = "/Users/test/.claude-personal";
    const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(claudeKeychainService(dir)).toBe(`Claude Code-credentials-${hash}`);
    expect(claudeKeychainService(dir)).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
  });
});

describe("claudeAccountFiles", () => {
  it("keeps the legacy file names for the default profile, whatever its id", () => {
    expect(claudeAccountFiles({ id: "sogni", label: "S" }, "/cache", HOME)).toEqual({
      credsPath: "/Users/test/.claude/.credentials.json",
      lastGoodPath: "/cache/claude-last-good.json",
      oauthCachePath: "/cache/claude-oauth.json",
    });
  });

  it("names a profile account's files after its profile folder, not its id", () => {
    const dir = "/Users/test/.claude-personal";
    const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    const files = claudeAccountFiles({ id: "personal", label: "P", configDir: dir }, "/cache", HOME);
    expect(files).toEqual({
      credsPath: "/Users/test/.claude-personal/.credentials.json",
      lastGoodPath: `/cache/claude-last-good-${hash}.json`,
      oauthCachePath: `/cache/claude-oauth-${hash}.json`,
    });
    // Renaming the id keeps the files. Pointing the same id at another profile
    // must not pick up the first profile's cached token or snapshot.
    expect(claudeAccountFiles({ id: "renamed", label: "R", configDir: dir }, "/cache", HOME)).toEqual(files);
    const moved = claudeAccountFiles({ id: "personal", label: "P", configDir: "/Users/test/.claude-other" }, "/cache", HOME);
    expect(moved.oauthCachePath).not.toBe(files.oauthCachePath);
    expect(moved.lastGoodPath).not.toBe(files.lastGoodPath);
  });
});
