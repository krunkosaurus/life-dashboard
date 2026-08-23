// Production launcher for `next start`, wrapping it only to resolve which
// address to bind. Defaults to loopback; `HOST=tailscale` binds the machine's
// tailnet address so other tailnet devices can reach the dashboard.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NEXT_BIN = path.join(repoRoot, "node_modules", ".bin", "next");

const FALLBACK_HOST = "127.0.0.1";
// Tailscale can still be connecting when pm2 resurrects us at login, and
// binding an address the machine doesn't hold yet fails with EADDRNOTAVAIL.
const WAIT_TOTAL_MS = 60_000;
const WAIT_INTERVAL_MS = 2_000;

// Tailscale hands out IPv4 addresses from the CGNAT range 100.64.0.0/10.
function findTailscaleIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [first, second] = a.address.split(".").map(Number);
      if (first === 100 && second >= 64 && second <= 127) return a.address;
    }
  }
  return null;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function resolveHost() {
  const requested = process.env.HOST?.trim();
  if (!requested) return FALLBACK_HOST;
  if (requested.toLowerCase() !== "tailscale") return requested;

  const deadline = Date.now() + WAIT_TOTAL_MS;
  let waited = false;
  for (;;) {
    const ip = findTailscaleIPv4();
    if (ip) {
      if (waited) console.log(`[start] tailscale address came up: ${ip}`);
      return ip;
    }
    if (Date.now() >= deadline) {
      // Falling back to loopback keeps the dashboard up locally instead of
      // crash-looping under pm2. Restart once Tailscale is connected.
      console.warn(
        `[start] no tailscale address after ${WAIT_TOTAL_MS / 1000}s — binding ${FALLBACK_HOST}; ` +
        `restart the process once Tailscale is connected`
      );
      return FALLBACK_HOST;
    }
    if (!waited) {
      console.log("[start] waiting for a tailscale address…");
      waited = true;
    }
    await sleep(WAIT_INTERVAL_MS);
  }
}

const host = await resolveHost();
const port = process.env.PORT || "3000";
console.log(`[start] next start -H ${host} (port ${port})`);

const child = spawn(NEXT_BIN, ["start", "-H", host, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
