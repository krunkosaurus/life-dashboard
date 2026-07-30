import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config";
import type { ServersResult, ServerStatus, TailscaleHostInput } from "./types";

const execFileAsync = promisify(execFile);

// `tailscale status --json` reflects the control plane's view of each peer,
// so checks work even when the dashboard host can't route to the peer.
// macOS GUI installs don't put the CLI on PATH, hence the app-bundle path.
const CLI_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
];

const SUCCESS_TTL_MS = 15_000;
const ERROR_TTL_MS = 60_000;
let cache: { at: number; ttl: number; result: ServersResult } | null = null;
let inFlight: Promise<ServersResult> | null = null;
let lastGood: Extract<ServersResult, { ok: true }> | null = null;

function findCli(): string {
  for (const p of CLI_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* keep looking */ }
  }
  return "tailscale"; // last resort: hope it's on PATH
}

type PeerInfo = { online: boolean; lastSeen: number | null; os?: string };

// Config hosts may be a bare hostname, an FQDN, or a Tailscale IP. IPs are
// matched verbatim; names are matched on the first DNS label.
export function normalizeHostKey(host: string): string {
  const t = host.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t) || t.includes(":")) return t;
  return t.split(".")[0];
}

// Tailscale reports LastSeen as "0001-01-01T00:00:00Z" for peers it has no
// sighting for (including currently-online ones) — treat that as unknown.
function parseLastSeen(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.floor(t / 1000);
}

export function parseTailscaleStatus(
  raw: unknown,
  hosts: TailscaleHostInput[]
): ServerStatus[] {
  const byKey = new Map<string, PeerInfo>();

  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const nodes: unknown[] = [];
    if (r.Self) nodes.push(r.Self);
    if (r.Peer && typeof r.Peer === "object") nodes.push(...Object.values(r.Peer));

    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const o = n as Record<string, unknown>;
      const info: PeerInfo = {
        online: o.Online === true,
        lastSeen: parseLastSeen(o.LastSeen),
        os: typeof o.OS === "string" ? o.OS : undefined,
      };
      const dns = typeof o.DNSName === "string" ? o.DNSName : "";
      const label = dns.split(".")[0]?.toLowerCase();
      if (label) byKey.set(label, info);
      // HostName can differ from the DNS label (case, renames); index it too
      // but never let it shadow another node's DNS label.
      const hostName = typeof o.HostName === "string" ? o.HostName.toLowerCase() : "";
      if (hostName && !byKey.has(hostName)) byKey.set(hostName, info);
      if (Array.isArray(o.TailscaleIPs)) {
        for (const ip of o.TailscaleIPs) {
          if (typeof ip === "string") byKey.set(ip.toLowerCase(), info);
        }
      }
    }
  }

  return hosts.map(h => {
    const info = byKey.get(normalizeHostKey(h.host));
    return {
      host: h.host,
      alias: h.alias ?? h.host,
      online: info?.online ?? false,
      lastSeen: info?.lastSeen ?? null,
      ...(info?.os ? { os: info.os } : {}),
      found: info != null,
    };
  });
}

export async function fetchTailscaleStatus(): Promise<ServersResult> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.result;
  if (inFlight) return inFlight;

  const request = doFetch().then((fresh) => {
    if (fresh.ok) lastGood = fresh;
    const result: ServersResult = fresh.ok
      ? fresh
      : lastGood
        ? { ...lastGood, staleReason: fresh.error }
        : fresh;
    cache = {
      at: Date.now(),
      ttl: fresh.ok ? SUCCESS_TTL_MS : ERROR_TTL_MS,
      result,
    };
    return result;
  });
  inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

export function describeTailscaleExecError(error: unknown): string {
  const e = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
    code?: string | number;
    signal?: string;
  };
  const message = e?.message?.trim().replace(/\s+/g, " ") || "unknown command error";
  const output = String(e?.stderr || e?.stdout || "").trim().replace(/\s+/g, " ").slice(-300);
  const status = e?.code != null
    ? `exit ${e.code}`
    : e?.signal
      ? `signal ${e.signal}`
      : "";
  const details = [status, output].filter(Boolean).join(": ");
  return details && !message.includes(output) ? `${message} (${details})` : message;
}

async function doFetch(): Promise<ServersResult> {
  const hosts = loadConfig().tailscaleHosts;
  if (hosts.length === 0) {
    return { ok: false, error: "no tailscaleHosts configured — add them to config.local.json" };
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(findCli(), ["status", "--json"], {
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (e) {
    const msg = describeTailscaleExecError(e);
    console.error(`[tailscale] status failed: ${msg}`);
    return { ok: false, error: `tailscale status failed: ${msg}` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "tailscale status returned invalid JSON" };
  }

  return {
    ok: true,
    servers: parseTailscaleStatus(raw, hosts),
    checkedAt: Math.floor(Date.now() / 1000),
  };
}
