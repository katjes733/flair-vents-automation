import { describe, it, expect } from "vitest";
import {
  roundToStep,
  assertCharacteristicWriteSucceeded,
} from "~/server/util/homekit/client";

// A real, confirmed live bug: this app pushed unrounded floats (e.g.
// 21.204661939005074) against a real CoolingThresholdTemperature
// characteristic whose own minStep is 0.1 — every write was silently
// ignored for ~10 minutes before one happened to land close enough to a
// valid step. See "Direct HomeKit Thermostat Control" in the plan.
describe("roundToStep", () => {
  it("rounds to the nearest 0.1 step, cleaning up floating-point noise", () => {
    expect(roundToStep(21.204661939005074, 0.1)).toBe(21.2);
    expect(roundToStep(21.03348352591677, 0.1)).toBe(21.0);
    expect(roundToStep(21.149084849389453, 0.1)).toBe(21.1);
  });

  it("rounds to a coarser step (e.g. 0.5) correctly, not assuming 0.1", () => {
    expect(roundToStep(21.3, 0.5)).toBe(21.5);
    expect(roundToStep(21.2, 0.5)).toBe(21.0);
  });

  it("is a no-op for a step of 0 or negative (defensive, not expected in practice)", () => {
    expect(roundToStep(21.204661939005074, 0)).toBe(21.204661939005074);
    expect(roundToStep(21.204661939005074, -1)).toBe(21.204661939005074);
  });

  it("returns an exact value unchanged when already aligned to the step", () => {
    expect(roundToStep(21.1, 0.1)).toBe(21.1);
  });
});

describe("assertCharacteristicWriteSucceeded", () => {
  const AID = 1;
  const IID = 13;

  it("does not throw for the 204 (full-success) response shape, which carries no status field", () => {
    expect(() =>
      assertCharacteristicWriteSucceeded(
        { characteristics: [{ aid: AID, iid: IID, value: 21.1 }] },
        AID,
        IID,
      ),
    ).not.toThrow();
  });

  it("does not throw when the response has no characteristics array at all", () => {
    expect(() =>
      assertCharacteristicWriteSucceeded(undefined, AID, IID),
    ).not.toThrow();
    expect(() =>
      assertCharacteristicWriteSucceeded({}, AID, IID),
    ).not.toThrow();
  });

  it("does not throw when the matching entry's status is 0 (explicit success)", () => {
    expect(() =>
      assertCharacteristicWriteSucceeded(
        { characteristics: [{ aid: AID, iid: IID, status: 0 }] },
        AID,
        IID,
      ),
    ).not.toThrow();
  });

  it("throws when the device rejected the write with a non-zero HAP status — the real bug this fixes", () => {
    expect(() =>
      assertCharacteristicWriteSucceeded(
        { characteristics: [{ aid: AID, iid: IID, status: -70410 }] },
        AID,
        IID,
      ),
    ).toThrow(/HAP status -70410/);
  });

  it("ignores a status entry for a different aid/iid than the one just written", () => {
    expect(() =>
      assertCharacteristicWriteSucceeded(
        { characteristics: [{ aid: AID, iid: 999, status: -70410 }] },
        AID,
        IID,
      ),
    ).not.toThrow();
  });
});
