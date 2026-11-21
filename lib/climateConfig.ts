import type { ClimateConfig } from "./climateTypes";

export function parseClimateConfig(raw: unknown): ClimateConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.hubUrl !== "string" || !input.hubUrl.trim()) return null;
  const sensorLabels: Record<string, string> = {};
  if (input.sensorLabels && typeof input.sensorLabels === "object") {
    for (const [id, label] of Object.entries(input.sensorLabels)) {
      if (typeof label === "string" && label.trim()) sensorLabels[id] = label.trim();
    }
  }
  return {
    hubUrl: input.hubUrl.trim().replace(/\/$/, ""),
    sensiboKeyFile: typeof input.sensiboKeyFile === "string" ? input.sensiboKeyFile : "~/.config/sensibo/credentials",
    timeZone: typeof input.timeZone === "string" ? input.timeZone : "Asia/Singapore",
    sensorLabels,
  };
}
