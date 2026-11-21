"use client";
import { useEffect, useState } from "react";
import type { ClaudeBonusResets as ResetStatus } from "@/lib/types";

const USAGE_PAGE = "https://claude.ai/settings/usage";

function pacificTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " PT";
}

export function ClaudeBonusResets({ status, stale, loading, onCheck }: {
  status?: ResetStatus;
  stale: boolean;
  loading: boolean;
  onCheck: () => void;
}) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (stale || status?.state !== "known") return;
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, [stale, status?.state]);
  // Only show reset information the dashboard can actually confirm.
  if (stale || status?.state !== "known") return null;
  const grants = status.grants.filter(g => g.expiresAt == null || g.expiresAt > now);
  const count = grants.reduce((sum, grant) => sum + grant.remaining, 0);
  const explanation = count === 0
    ? "No unused bonus resets were reported."
    : "Refills the limits listed in your offer. Your regular weekly reset day stays the same.";

  return (
    <div style={{ background: "#0c1015", border: "1px solid #1c222b", borderRadius: 8, padding: "9px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
        <span style={{ color: "#9aa6b8" }}>Bonus reset</span>
        <strong style={{ color: count > 0 ? "#7aa2f7" : "#9aa6b8" }}>
          {`${count} ${count === 1 ? "reset" : "resets"} banked`}
        </strong>
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.5, color: "#9aa6b8", margin: "7px 0" }}>{explanation}</p>
      {grants.map((grant, index) => (
        <div key={index} style={{ fontSize: 12, lineHeight: 1.5, margin: "7px 0", color: "#9aa6b8" }}>
          <div>{grant.title}{grant.remaining > 1 ? ` · ${grant.remaining} resets` : ""}</div>
          <div>
            {grant.paused ? "Temporarily paused"
              : grant.startsAt != null && grant.startsAt > now ? `Starts ${pacificTime(grant.startsAt)}`
                : grant.usableNow ? "Ready to use"
                  : grant.requiresLimit ? "Available when you reach a usage limit"
                    : "Check Claude before using"}
            {grant.limits.length > 0 && ` · ${grant.limits.join(" + ")}`}
          </div>
          <div>{grant.expiresAt != null ? `Expires ${pacificTime(grant.expiresAt)}` : "No expiry reported"}</div>
        </div>
      ))}
      {status.cooldownUntil != null && status.cooldownUntil > now && (
        <p style={{ fontSize: 12, color: "#9aa6b8" }}>Next use after {pacificTime(status.cooldownUntil)}</p>
      )}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 12 }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => { setChecked(true); onCheck(); }}
          style={{ background: "transparent", color: "#7aa2f7", border: "1px solid #303b4a", borderRadius: 5, padding: "4px 8px", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Checking…" : "Check reset"}
        </button>
        <a href={USAGE_PAGE} target="_blank" rel="noopener noreferrer" style={{ color: "#7aa2f7" }}>
          {count > 0 ? "Use in Claude ↗" : "Open Claude Usage ↗"}
        </a>
        <span role="status" style={{ color: "#7a8595" }}>
          {checked && !loading ? "Checked" : ""}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#7a8595", marginTop: 7 }}>
        In Claude: Resets → Reset for free. Checking here does not use a reset.
      </div>
    </div>
  );
}
