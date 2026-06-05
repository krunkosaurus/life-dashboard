import fs from "node:fs";
import path from "node:path";
import type { AppConfig, LifeConfig, ManualEventInput } from "./types";

const DEFAULT_REFRESH = 60;
const MIN_REFRESH = 5;
const CONFIG_PATH = path.join(process.cwd(), "config.local.json");

// Treat the example/placeholder values as unset so users who copy
// config.example.json verbatim see the friendly "not configured" message
// instead of a real HTTP error.
function isPlaceholder(url: string): boolean {
  return (
    url.includes("/calendar/ical/.../basic.ics") ||
    url.includes("REPLACE_ME") ||
    url.includes("<paste") ||
    url.trim() === ""
  );
}

export function parseConfig(
  file: Record<string, unknown>,
  env: Record<string, string | undefined>
): AppConfig {
  const raw =
    (env.ICS_URL && String(env.ICS_URL)) ||
    (typeof file.icsUrl === "string" ? file.icsUrl : null);
  const icsUrl = raw && !isPlaceholder(raw) ? raw : null;

  const pinnedEvents = Array.isArray(file.pinnedEvents)
    ? file.pinnedEvents.filter((s): s is string => typeof s === "string")
    : [];

  const manualEvents: ManualEventInput[] = Array.isArray(file.manualEvents)
    ? file.manualEvents.flatMap((e): ManualEventInput[] => {
        if (!e || typeof e !== "object") return [];
        const o = e as Record<string, unknown>;
        if (typeof o.title !== "string" || typeof o.start !== "string") return [];
        const out: ManualEventInput = { title: o.title, start: o.start };
        if (o.pinned === true) out.pinned = true;
        return [out];
      })
    : [];

  const refreshRaw =
    typeof file.refreshSeconds === "number" ? file.refreshSeconds : DEFAULT_REFRESH;
  const refreshSeconds = Math.max(MIN_REFRESH, Math.floor(refreshRaw));

  let life: LifeConfig | null = null;
  if (file.life && typeof file.life === "object") {
    const o = file.life as Record<string, unknown>;
    if (
      typeof o.birthDate === "string" &&
      !Number.isNaN(Date.parse(o.birthDate)) &&
      typeof o.expectancyYears === "number" &&
      o.expectancyYears > 0
    ) {
      life = { birthDate: o.birthDate, expectancyYears: o.expectancyYears };
    }
  }

  return { icsUrl, manualEvents, pinnedEvents, refreshSeconds, life };
}

export function loadConfig(): AppConfig {
  let file: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {
    file = {};
  }
  return parseConfig(file, process.env);
}
