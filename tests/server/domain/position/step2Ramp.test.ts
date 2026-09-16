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
        deadZoneRecoveryJumpPct: 10,
      }),
    ).toBe(80);
  });

  it("converges over multiple ticks toward a large jump, one step per tick", () => {
    // deadZoneRecoveryJumpPct matches the plain max-size step here
    // deliberately — this test exercises the ordinary ramp, not dead-zone
    // recovery, even though the very first tick's origin (0) is itself a
    // hard extreme. See the dedicated "dead-zone recovery" describe block
    // below for the jump behavior itself.
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
        deadZoneRecoveryJumpPct: 10,
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
        deadZoneRecoveryJumpPct: 10,
      }),
    ).toBe(47);
  });
});

describe("rampTowardTarget — dead-zone recovery", () => {
  it("jumps straight to deadZoneRecoveryJumpPct when leaving a fully-closed vent, instead of an ordinary step", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 80,
        lastCommandedTarget: 0,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 100,
        deadZoneRecoveryJumpPct: 50,
      }),
    ).toBe(50);
  });

  it("jumps symmetrically when leaving a fully-open vent that needs to close", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 20,
        lastCommandedTarget: 100,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 100,
        deadZoneRecoveryJumpPct: 50,
      }),
    ).toBe(50);
  });

  it("overshoots the jump past a small target and lets the ordinary ramp correct back down on the next tick", () => {
    // desiredPosition (15) is well below deadZoneRecoveryJumpPct (50) —
    // deliberately still jumps all the way to 50 rather than capping at
    // the target, per the explicit design: clear the stiction first, let
    // the normal ramp settle from there in whichever direction is needed.
    const afterJump = rampTowardTarget({
      desiredPosition: 15,
      lastCommandedTarget: 0,
      modulationStepPct: 10,
      maxStepsPerTick: 1,
      minVentPosition: 0,
      maxVentPosition: 100,
      deadZoneRecoveryJumpPct: 50,
    });
    expect(afterJump).toBe(50);

    const afterNextTick = rampTowardTarget({
      desiredPosition: 15,
      lastCommandedTarget: afterJump,
      modulationStepPct: 10,
      maxStepsPerTick: 1,
      minVentPosition: 0,
      maxVentPosition: 100,
      deadZoneRecoveryJumpPct: 50,
    });
    // Back on the ordinary ramp now that origin (50) is no longer at an
    // extreme — one normal step back down toward 15, not another jump.
    expect(afterNextTick).toBe(40);
  });

  it("does not jump when the vent is already resting exactly at the extreme it's meant to hold", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 0,
        lastCommandedTarget: 0,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 100,
        deadZoneRecoveryJumpPct: 50,
      }),
    ).toBe(0);
  });

  it("clamps the jump to maxVentPosition when the configured ceiling sits below deadZoneRecoveryJumpPct", () => {
    expect(
      rampTowardTarget({
        desiredPosition: 30,
        lastCommandedTarget: 0,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        minVentPosition: 0,
        maxVentPosition: 40,
        deadZoneRecoveryJumpPct: 50,
      }),
    ).toBe(40);
  });
});
