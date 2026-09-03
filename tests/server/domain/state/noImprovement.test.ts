import { describe, it, expect } from "vitest";
import { detectNoImprovement } from "~/server/domain/state/noImprovement";

describe("detectNoImprovement", () => {
  it("stays quiet before the configured duration is reached, even with zero improvement", () => {
    expect(
      detectNoImprovement({
        worstDeviationAtStart: 3,
        currentWorstDeviation: 3,
        durationMinutes: 10,
        alertMinutes: 75,
      }),
    ).toBe(false);
  });

  it("fires once duration is reached and the deviation hasn't meaningfully shrunk", () => {
    expect(
      detectNoImprovement({
        worstDeviationAtStart: 3,
        currentWorstDeviation: 2.8, // within the noise-floor margin — not real improvement
        durationMinutes: 80,
        alertMinutes: 75,
      }),
    ).toBe(true);
  });

  it("stays quiet once real improvement (beyond the margin) has happened", () => {
    expect(
      detectNoImprovement({
        worstDeviationAtStart: 3,
        currentWorstDeviation: 2, // shrunk by a full degree — real progress
        durationMinutes: 80,
        alertMinutes: 75,
      }),
    ).toBe(false);
  });

  it("fires when the deviation has actually gotten worse", () => {
    expect(
      detectNoImprovement({
        worstDeviationAtStart: 3,
        currentWorstDeviation: 4,
        durationMinutes: 80,
        alertMinutes: 75,
      }),
    ).toBe(true);
  });

  it("stays quiet with no snapshot yet (no call/demand period in progress)", () => {
    expect(
      detectNoImprovement({
        worstDeviationAtStart: null,
        currentWorstDeviation: 5,
        durationMinutes: 100,
        alertMinutes: 75,
      }),
    ).toBe(false);
  });
});
