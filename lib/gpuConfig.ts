import type { GpuHostConfig } from "./gpuTypes";

export function parseGpuHosts(input: unknown): GpuHostConfig[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  return input.flatMap((value): GpuHostConfig[] => {
    if (!value || typeof value !== "object") return [];
    const host = value as Record<string, unknown>;
    const destination = /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/;
    if (typeof host.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(host.id) || ids.has(host.id)) return [];
    if (typeof host.sshHost !== "string" || !destination.test(host.sshHost)) return [];
    if (host.platform !== "linux" && host.platform !== "windows") return [];
    if (host.jumpHost !== undefined && (typeof host.jumpHost !== "string" || !destination.test(host.jumpHost))) return [];
    ids.add(host.id);
    return [{
      id: host.id,
      label: typeof host.label === "string" && host.label.trim() ? host.label.trim() : host.id,
      group: typeof host.group === "string" && host.group.trim() ? host.group.trim() : "GPU hosts",
      sshHost: host.sshHost,
      platform: host.platform,
      ...(typeof host.jumpHost === "string" ? { jumpHost: host.jumpHost } : {}),
    }];
  });
}
