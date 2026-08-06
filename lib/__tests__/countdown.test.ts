import { describe, expect, it } from "vitest";
import { formatCountdown } from "../countdown";

describe("formatCountdown", () => {
  it("formats time remaining", () => {
    expect(formatCountdown(90_061)).toBe("1d \u20071h \u20071m \u20071s");
  });

  it("keeps elapsed time negative while formatting its parts as magnitudes", () => {
    expect(formatCountdown(-90_061)).toBe("-1d \u20071h \u20071m \u20071s");
  });
});
