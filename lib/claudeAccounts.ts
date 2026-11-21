import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

// One Claude account whose usage the dashboard shows. `configDir` is the
// Claude Code profile folder the account is logged into (the value given to
// CLAUDE_CONFIG_DIR); absent means Claude Code's default profile.
export type ClaudeAccount = { id: string; label: string; configDir?: string };

export const DEFAULT_CLAUDE_ACCOUNT: ClaudeAccount = { id: "default", label: "Claude Code" };

const ACCOUNT_ID = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_SERVICE = "Claude Code-credentials";

// Resolve a configured profile folder to the exact string Claude Code hashes
// for its Keychain item: absolute, no trailing slash, NFC. Null when unusable.
function normalizeConfigDir(input: unknown, homeDir: string): string | null {
  if (typeof input !== "string") return null;
  let dir = input.trim();
  if (dir === "~") dir = homeDir;
  else if (dir.startsWith("~/")) dir = path.join(homeDir, dir.slice(2));
  if (!path.isAbsolute(dir)) return null;
  dir = dir.replace(/\/+$/, "") || "/";
  return dir.normalize("NFC");
}

// Validate `claudeAccounts` defensively, like the other config blocks. An
// entry whose `configDir` is present but unusable is dropped rather than
// treated as the default profile, which would show another account's usage
// under its label. Nothing usable → the single default account.
export function parseClaudeAccounts(input: unknown, homeDir = os.homedir()): ClaudeAccount[] {
  if (!Array.isArray(input)) return [DEFAULT_CLAUDE_ACCOUNT];
  const ids = new Set<string>();
  const profiles = new Set<string>();
  const accounts = input.flatMap((value): ClaudeAccount[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const o = value as Record<string, unknown>;
    if (typeof o.id !== "string" || !ACCOUNT_ID.test(o.id) || ids.has(o.id)) return [];
    let configDir: string | undefined;
    if ("configDir" in o) {
      const dir = normalizeConfigDir(o.configDir, homeDir);
      if (dir === null) return [];
      configDir = dir;
    }
    const profile = configDir ?? "";
    if (profiles.has(profile)) return [];
    ids.add(o.id);
    profiles.add(profile);
    const label = typeof o.label === "string" && o.label.trim() !== "" ? o.label.trim() : o.id;
    return [{ id: o.id, label, ...(configDir ? { configDir } : {}) }];
  });
  return accounts.length > 0 ? accounts : [DEFAULT_CLAUDE_ACCOUNT];
}

// No id selects the default-profile account, so callers that predate multiple
// accounts keep getting the same one however the list is ordered for display
// (the first account when none uses the default profile). An unknown id never
// falls back to another account.
export function findClaudeAccount(accounts: ClaudeAccount[], id: string | null): ClaudeAccount | undefined {
  if (id === null || id === "") return accounts.find(account => !account.configDir) ?? accounts[0];
  return accounts.find(account => account.id === id);
}

// "-<first 8 hex of sha256(configDir)>" for a profile folder, "" for the
// default profile. Identifies the profile wherever a name must follow it.
function profileSuffix(configDir?: string): string {
  return configDir ? `-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}` : "";
}

// Claude Code names a non-default profile's Keychain item with the first 8 hex
// characters of sha256(CLAUDE_CONFIG_DIR).
export function claudeKeychainService(configDir?: string): string {
  return `${DEFAULT_SERVICE}${profileSuffix(configDir)}`;
}

// The dashboard's cache files follow the profile folder, not the account id:
// an id pointed at a different profile must never pick up the previous
// profile's cached token or snapshot. The default profile keeps the file
// names used before multiple accounts existed.
export function claudeAccountFiles(
  account: ClaudeAccount,
  cacheDir: string,
  homeDir = os.homedir(),
): { credsPath: string; lastGoodPath: string; oauthCachePath: string } {
  const suffix = profileSuffix(account.configDir);
  return {
    credsPath: path.join(account.configDir ?? path.join(homeDir, ".claude"), ".credentials.json"),
    lastGoodPath: path.join(cacheDir, `claude-last-good${suffix}.json`),
    oauthCachePath: path.join(cacheDir, `claude-oauth${suffix}.json`),
  };
}
