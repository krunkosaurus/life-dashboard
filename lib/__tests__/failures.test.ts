import { describe, it, expect } from "vitest";
import { recordFailure } from "../failures";

describe("recordFailure", () => {
  it("appends a new failure with count 1", () => {
    const log = recordFailure([], "usage endpoint HTTP 500", 1000);
    expect(log).toEqual([{ message: "usage endpoint HTTP 500", at: 1000, count: 1 }]);
  });

  it("collapses consecutive repeats into one entry with a bumped count and fresh timestamp", () => {
    let log = recordFailure([], "token refresh HTTP 400 (invalid_grant)", 1000);
    log = recordFailure(log, "token refresh HTTP 400 (invalid_grant)", 1300);
    expect(log).toEqual([
      { message: "token refresh HTTP 400 (invalid_grant)", at: 1300, count: 2 },
    ]);
  });

  it("does not collapse non-consecutive repeats", () => {
    let log = recordFailure([], "error A", 1000);
    log = recordFailure(log, "error B", 1100);
    log = recordFailure(log, "error A", 1200);
    expect(log.map((f) => f.message)).toEqual(["error A", "error B", "error A"]);
    expect(log.map((f) => f.count)).toEqual([1, 1, 1]);
  });

  it("caps the log at max entries, dropping the oldest", () => {
    let log: ReturnType<typeof recordFailure> = [];
    for (let i = 0; i < 7; i++) log = recordFailure(log, `error ${i}`, 1000 + i, 5);
    expect(log).toHaveLength(5);
    expect(log[0].message).toBe("error 2");
    expect(log[4].message).toBe("error 6");
  });

  it("does not mutate the input log", () => {
    const original = recordFailure([], "error A", 1000);
    const snapshot = JSON.parse(JSON.stringify(original));
    recordFailure(original, "error A", 1100);
    recordFailure(original, "error B", 1200);
    expect(original).toEqual(snapshot);
  });
});
