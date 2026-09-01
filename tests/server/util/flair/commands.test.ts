import { describe, it, expect } from "vitest";
import {
  roundSetpointForFlair,
  avoidFlairRejectedPercentOpen,
  dispatchVentPosition,
  pushSetpoint,
} from "~/server/util/flair/commands";
import { FakeFlairClient } from "../../../helpers/fakeFlairClient";

describe("roundSetpointForFlair", () => {
  it("rounds to the configured granularity", () => {
    expect(roundSetpointForFlair(21.3, 0.5)).toBeCloseTo(21.5, 5);
    expect(roundSetpointForFlair(21.2, 0.5)).toBeCloseTo(21, 5);
  });
});

describe("avoidFlairRejectedPercentOpen", () => {
  it("nudges the confirmed-rejected value 50 down to 49", () => {
    expect(avoidFlairRejectedPercentOpen(50)).toBe(49);
  });

  it("leaves every neighboring value unchanged", () => {
    expect(avoidFlairRejectedPercentOpen(49)).toBe(49);
    expect(avoidFlairRejectedPercentOpen(51)).toBe(51);
    expect(avoidFlairRejectedPercentOpen(0)).toBe(0);
    expect(avoidFlairRejectedPercentOpen(100)).toBe(100);
  });
});

describe("dispatchVentPosition", () => {
  it("rounds to a whole percentage before calling the client", async () => {
    const client = new FakeFlairClient();
    await dispatchVentPosition(client, "vent-1", 47.6);
    expect(client.getVentCommandHistory()[0]).toMatchObject({
      ventId: "vent-1",
      percentOpen: 48,
    });
  });

  it("nudges a rounded 50 to 49 before calling the client", async () => {
    const client = new FakeFlairClient();
    await dispatchVentPosition(client, "vent-1", 50);
    expect(client.getVentCommandHistory()[0]).toMatchObject({
      ventId: "vent-1",
      percentOpen: 49,
    });
  });
});

describe("pushSetpoint", () => {
  it("rounds and passes the value straight through with no unit conversion", async () => {
    const client = new FakeFlairClient();
    const rounded = await pushSetpoint(client, "structure-1", 21.3, 0.5);
    expect(rounded).toBeCloseTo(21.5, 5);
    expect(client.getSetpointCommandHistory()[0]).toMatchObject({
      structureId: "structure-1",
      setpointC: 21.5,
    });
  });
});
