import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ callbacks: [] as ((error: Error | null, stdout: string, stderr: string) => void)[], active: 0, peak: 0, calls: 0 }));
vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    state.calls++;
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    state.callbacks.push((error, stdout, stderr) => { state.active--; callback(error, stdout, stderr); });
    return { stdin: { on: () => {}, end: () => {} } };
  },
}));
vi.mock("node:fs/promises", () => ({ default: { readFile: async () => "read-only probe" } }));
vi.mock("../config", () => ({
  loadConfig: () => ({ gpuHosts: Array.from({ length: 9 }, (_, i) => ({ id: `host-${i}`, label: `Host ${i}`, group: "Test", sshHost: `host-${i}`, platform: "linux" })) }),
}));

async function drain() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    while (state.callbacks.length) state.callbacks.shift()!(new Error("Connection refused"), "", "Connection refused");
  }
}

describe("on-demand GPU collection", () => {
  it("does no work on import, shares simultaneous visits, limits concurrency, and stops when finished", async () => {
    const { fetchGpuHealth } = await import("../gpuHealth");
    expect(state.calls).toBe(0);
    const first = fetchGpuHealth();
    const second = fetchGpuHealth();
    expect(first).toBe(second);
    await drain();
    const result = await first;
    expect(result.hosts).toHaveLength(9);
    expect(result.hosts.every(host => host.status === "unreachable")).toBe(true);
    expect(result.hosts.map(host => host.id)).toEqual(Array.from({ length: 9 }, (_, i) => `host-${i}`));
    expect(state.peak).toBe(4);
    expect(state.calls).toBe(9);
    expect(state.active).toBe(0);
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(state.calls).toBe(9);
    } finally {
      vi.useRealTimers();
    }
    const nextVisit = fetchGpuHealth();
    expect(nextVisit).not.toBe(first);
    await drain();
    await nextVisit;
    expect(state.calls).toBe(18);
  });
});
