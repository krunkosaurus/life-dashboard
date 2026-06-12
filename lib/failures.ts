import type { UsageFailure } from "./types";

const MAX_ENTRIES = 5;

// Append a failure to a per-source log, collapsing consecutive repeats of the
// same message into one entry with a bumped count and refreshed timestamp.
// Capped to the newest `max` entries. Pure — returns a new array.
export function recordFailure(
  log: UsageFailure[],
  message: string,
  at: number,
  max = MAX_ENTRIES,
): UsageFailure[] {
  const last = log[log.length - 1];
  if (last && last.message === message) {
    return [...log.slice(0, -1), { message, at, count: last.count + 1 }];
  }
  return [...log, { message, at, count: 1 }].slice(-max);
}
