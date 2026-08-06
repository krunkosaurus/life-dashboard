// Pad with figure space (U+2007) — the same width as a tabular digit — so the
// countdown stays aligned without displaying leading zeroes.
function pad(n: number): string {
  return n.toString().padStart(2, "\u2007");
}

export function formatCountdown(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const seconds = Math.abs(Math.trunc(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${sign}${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(remainder)}s`;
}
