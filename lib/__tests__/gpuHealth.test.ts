import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { assessGpuHealth, describeGpuError, parseProbeOutput, windowsProbeCommand } from "../gpuHealth";
import { parseGpuHosts } from "../gpuConfig";
import type { GpuProbe } from "../gpuTypes";

const sample = (): GpuProbe => ({
  schema: 1, os: "Ubuntu", uptimeSeconds: 1000,
  cpu: { name: "Test CPU", cores: 20, utilization: 30, temperatureC: 50, load1: 2 },
  memory: { totalMiB: 128000, availableMiB: 32000, swapUsedMiB: 0 },
  disks: [{ mount: "/", totalGiB: 1000, freeGiB: 400 }], driver: "580.173.02", cuda: "13.0",
  gpus: [{ name: "NVIDIA GB10", utilization: 100, temperatureC: 65, thermalHeadroomC: 30,
    thermalSlowdown: false, memoryUsedMiB: null, memoryTotalMiB: null, powerW: 40,
    powerLimitW: null, fanPercent: null, uncorrectedErrors: null }],
  updates: { pending: 0, security: 0, checkedAt: Date.now() / 1000, rebootRequired: false, source: "cached" },
  services: [], events: [], limitations: [],
});

describe("GPU health interpretation", () => {
  it("treats a fully utilized GPU and shared memory as normal", () => {
    expect(assessGpuHealth(sample())).toEqual({ status: "healthy", issues: [] });
  });

  it("detects thermal slowdown on any GPU, including the second card", () => {
    const probe = sample();
    probe.gpus.push({ ...probe.gpus[0], thermalSlowdown: true });
    const result = assessGpuHealth(probe);
    expect(result.status).toBe("critical");
    expect(result.issues[0].title).toBe("GPU 2 is thermally throttling");
  });

  it("uses driver thermal headroom even below the generic temperature threshold", () => {
    const probe = sample();
    probe.gpus[0].thermalHeadroomC = 3;
    expect(assessGpuHealth(probe).issues[0].title).toContain("thermal limit");
  });

  it("keeps model VRAM allocation informational instead of diagnosing a failure", () => {
    const probe = sample();
    probe.gpus[0].memoryUsedMiB = 24000;
    probe.gpus[0].memoryTotalMiB = 24576;
    expect(assessGpuHealth(probe).status).toBe("healthy");
    expect(assessGpuHealth(probe).issues[0].severity).toBe("info");
  });

  it("flags actual low available RAM, low disk space, and reboot requirements", () => {
    const probe = sample();
    probe.memory.availableMiB = 1000;
    probe.disks[0].freeGiB = 20;
    probe.updates.rebootRequired = true;
    const result = assessGpuHealth(probe);
    expect(result.status).toBe("critical");
    expect(result.issues.map(issue => issue.title)).toEqual(["Little system memory available", "/ is running low on space", "Restart pending"]);
  });

  it("does not call an incomplete check healthy", () => {
    const probe = sample();
    probe.limitations = ["Kernel log permissions denied"];
    expect(assessGpuHealth(probe).status).toBe("unknown");
    probe.gpus = [];
    expect(assessGpuHealth(probe).issues[0].title).toBe("GPU readings unavailable");
  });

  it("surfaces observed OOM and WSL GPU errors as historical findings", () => {
    const probe = sample();
    probe.events = [{ at: 100, message: "Memory cgroup out of memory: Killed process 24998 (python)" }, { at: 101, message: "misc dxg: dxgk: dxgkio_make_resident: Ioctl failed: -12" }];
    const result = assessGpuHealth(probe);
    expect(result.status).toBe("warning");
    expect(result.issues.map(issue => issue.title)).toContain("An out-of-memory kill was logged");
    expect(result.issues.map(issue => issue.title)).toContain("GPU driver errors were logged");
  });

  it("accepts Spark login banners and Windows CRLF without inventing zeroes", () => {
    const json = JSON.stringify(sample());
    expect(parseProbeOutput(`Lease reserved\r\n${json}\r\n`).gpus[0].memoryTotalMiB).toBeNull();
    expect(() => parseProbeOutput("python3: command not found")).toThrow();
    expect(() => parseProbeOutput('{"schema":2,"gpus":[]}')).toThrow();
  });

  it("explains auth and timeout failures without exposing command contents", () => {
    expect(describeGpuError({ stderr: "Permission denied (publickey)." })).toContain("authentication");
    expect(describeGpuError({ killed: true, message: "ssh secret-script" })).toContain("time limit");
    expect(describeGpuError({ message: "ssh secret-script" })).not.toContain("secret-script");
  });

  it("keeps the complete Windows probe inside the cmd.exe command-line limit", () => {
    const script = fs.readFileSync("scripts/gpu-health-windows.ps1", "utf8");
    const command = windowsProbeCommand(script);
    expect(command.length).toBeLessThan(8100);
    const bootstrap = Buffer.from(command.split(" ").at(-1)!, "base64").toString("utf16le");
    const payload = bootstrap.match(/FromBase64String\('([^']+)'\)/)![1];
    expect(gunzipSync(Buffer.from(payload, "base64")).toString()).toBe(script);
    expect(script).toContain("$searcher.Online = $false");
  });
});

describe("GPU host configuration", () => {
  it("keeps SSH destinations server-only and rejects option or command injection", () => {
    const host = { id: "gpu", sshHost: "user@gpu", platform: "linux" };
    expect(parseGpuHosts([host])).toEqual([{ ...host, label: "gpu", group: "GPU hosts" }]);
    expect(parseGpuHosts([{ ...host, sshHost: "-oProxyCommand=bad" }])).toEqual([]);
    expect(parseGpuHosts([{ ...host, sshHost: "gpu; bad" }])).toEqual([]);
    expect(parseGpuHosts([{ ...host, jumpHost: "gpu $(bad)" }])).toEqual([]);
    expect(parseGpuHosts([host, host])).toHaveLength(1);
    expect(parseGpuHosts(undefined)).toEqual([]);
  });
});
