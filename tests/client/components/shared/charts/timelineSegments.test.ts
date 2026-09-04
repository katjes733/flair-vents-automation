import { describe, it, expect } from "vitest";
import {
  buildStepSegments,
  computeTruePeriods,
} from "~/client/components/shared/charts/timelineSegments";

describe("buildStepSegments", () => {
  it("holds each sample's value until the next sample, closing the last one at domainEndMs", () => {
    const segments = buildStepSegments(
      [
        { timeMs: 100, value: "A" },
        { timeMs: 200, value: "B" },
      ],
      300,
      (v) => (v === "A" ? "red" : "blue"),
      (v) => v,
    );
    expect(segments).toEqual([
      { startMs: 100, endMs: 200, color: "red", label: "A" },
      { startMs: 200, endMs: 300, color: "blue", label: "B" },
    ]);
  });

  it("sorts out-of-order samples before building segments", () => {
    const segments = buildStepSegments(
      [
        { timeMs: 200, value: "B" },
        { timeMs: 100, value: "A" },
      ],
      300,
      () => "x",
      (v) => v,
    );
    expect(segments.map((s) => s.label)).toEqual(["A", "B"]);
  });

  it("drops a segment that would have zero or negative width", () => {
    const segments = buildStepSegments(
      [
        { timeMs: 100, value: "A" },
        { timeMs: 100, value: "B" },
      ],
      300,
      () => "x",
      (v) => v,
    );
    expect(segments).toHaveLength(1);
  });

  it("returns no segments for an empty sample list", () => {
    expect(
      buildStepSegments(
        [],
        100,
        () => "x",
        () => "y",
      ),
    ).toEqual([]);
  });
});

describe("computeTruePeriods", () => {
  it("collapses adjacent true samples into one period", () => {
    const periods = computeTruePeriods(
      [
        { timeMs: 100, value: false },
        { timeMs: 200, value: true },
        { timeMs: 300, value: true },
        { timeMs: 400, value: false },
      ],
      500,
    );
    expect(periods).toEqual([{ startMs: 200, endMs: 400 }]);
  });

  it("closes a still-true final sample at domainEndMs", () => {
    const periods = computeTruePeriods(
      [
        { timeMs: 100, value: false },
        { timeMs: 200, value: true },
      ],
      500,
    );
    expect(periods).toEqual([{ startMs: 200, endMs: 500 }]);
  });

  it("finds multiple separate periods", () => {
    const periods = computeTruePeriods(
      [
        { timeMs: 100, value: true },
        { timeMs: 200, value: false },
        { timeMs: 300, value: true },
        { timeMs: 400, value: false },
      ],
      500,
    );
    expect(periods).toEqual([
      { startMs: 100, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ]);
  });

  it("returns no periods when nothing is ever true", () => {
    const periods = computeTruePeriods(
      [
        { timeMs: 100, value: false },
        { timeMs: 200, value: false },
      ],
      500,
    );
    expect(periods).toEqual([]);
  });
});
