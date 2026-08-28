import { describe, it, expect } from "vitest";
import { rampTowardTarget } from "~/server/domain/position/step2Ramp";

describe("rampTowardTarget", () => {
  it("snaps directly to the desired position with no prior commanded target", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 80,
        lastCommandedTarget: null,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 100,
      }),
    ).toBe(80);
  });

  it("converges over multiple ticks toward a large jump, one step per tick", () => {
    let target: number | null = 0;
    const steps: number[] = [];
    for (let tick = 0; tick < 10; tick++) {
      target = rampTowardTarget({
        desiredPosition: 100,
        lastCommandedTarget: target,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 100,
      });
      steps.push(target);
    }
    expect(steps).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("re-clamps after quantization breaches max_vent_position (the plan's 47%/10% example)", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 47,
        lastCommandedTarget: 47,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 47,
      }),
    ).toBe(47);
  });
});
