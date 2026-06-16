import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readState, applyToggle } from "../checklistState";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "checklist-state-"));
  file = path.join(dir, "nested", "state.json"); // nested → also exercises mkdir
  process.env.CHECKLIST_STATE_PATH = file;
});

afterEach(() => {
  delete process.env.CHECKLIST_STATE_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readState", () => {
  it("returns an empty state when the file is absent", () => {
    expect(readState()).toEqual({ version: 1, days: {}, weeks: {} });
  });

  it("returns an empty state when the file is malformed", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json{");
    expect(readState()).toEqual({ version: 1, days: {}, weeks: {} });
  });
});

describe("applyToggle", () => {
  it("sets a day-scoped id and persists it to disk", () => {
    applyToggle({ scope: "day", key: "2026-06-15", id: "morning-cold-plunge", value: true });
    expect(readState().days["2026-06-15"]).toEqual({ "morning-cold-plunge": true });
  });

  it("sets a week-scoped id under weeks, leaving days untouched", () => {
    const state = applyToggle({ scope: "week", key: "2026-06-15", id: "weekly-long-run", value: true });
    expect(state.weeks["2026-06-15"]).toEqual({ "weekly-long-run": true });
    expect(state.days).toEqual({});
  });

  it("deletes an id when toggled false and prunes the now-empty bucket", () => {
    applyToggle({ scope: "day", key: "2026-06-15", id: "a", value: true });
    applyToggle({ scope: "day", key: "2026-06-15", id: "b", value: true });
    applyToggle({ scope: "day", key: "2026-06-15", id: "a", value: false });
    expect(readState().days["2026-06-15"]).toEqual({ b: true });
    applyToggle({ scope: "day", key: "2026-06-15", id: "b", value: false });
    expect(readState().days["2026-06-15"]).toBeUndefined();
  });

  it("accumulates multiple keys and scopes across calls", () => {
    applyToggle({ scope: "day", key: "2026-06-15", id: "a", value: true });
    applyToggle({ scope: "day", key: "2026-06-16", id: "a", value: true });
    applyToggle({ scope: "week", key: "2026-06-15", id: "w", value: true });
    const s = readState();
    expect(Object.keys(s.days).sort()).toEqual(["2026-06-15", "2026-06-16"]);
    expect(s.weeks["2026-06-15"]).toEqual({ w: true });
  });
});
