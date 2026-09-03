import { describe, it, expect } from "vitest";
import { classifyStaleness } from "~/server/domain/sensors/staleness";

const NOW = Date.UTC(2024, 0, 1, 12, 0);

describe("classifyStaleness", () => {
  it("is stale once the reading age reaches the threshold", () => {
    expect(
      classifyStaleness({
        lastReadingChangedAtMs: NOW - 15 * 60000,
        nowMs: NOW,
        staleThresholdMinutes: 15,
        previousClassification: "demanding",
      }).stale,
    ).toBe(true);
  });

  it("is not stale below the threshold", () => {
    expect(
      classifyStaleness({
        lastReadingChangedAtMs: NOW - 14 * 60000,
        nowMs: NOW,
        staleThresholdMinutes: 15,
        previousClassification: "demanding",
      }).stale,
    ).toBe(false);
  });

  it("never flags a zone already classified satisfied on the previous tick", () => {
    expect(
      classifyStaleness({
        lastReadingChangedAtMs: NOW - 60 * 60000,
        nowMs: NOW,
        staleThresholdMinutes: 15,
        previousClassification: "satisfied",
      }).stale,
    ).toBe(false);
  });

  it("auto-resumes with no manual step once the reading changes again", () => {
    const stillStale = classifyStaleness({
      lastReadingChangedAtMs: NOW - 60 * 60000,
      nowMs: NOW,
      staleThresholdMinutes: 15,
      previousClassification: "demanding",
    });
    expect(stillStale.stale).toBe(true);

    const resumed = classifyStaleness({
      lastReadingChangedAtMs: NOW, // the reading just changed
      nowMs: NOW,
      staleThresholdMinutes: 15,
      previousClassification: "demanding",
    });
    expect(resumed.stale).toBe(false);
  });

  it("treats a never-updated reading as not stale (nothing to compare against yet)", () => {
    expect(
      classifyStaleness({
        lastReadingChangedAtMs: null,
        nowMs: NOW,
        staleThresholdMinutes: 15,
        previousClassification: null,
      }).stale,
    ).toBe(false);
  });
});
