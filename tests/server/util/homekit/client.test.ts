import { describe, it, expect, vi } from "vitest";
import {
  HapControllerClient,
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

describe("HapControllerClient reconnection", () => {
  const pairingData = { iOSDevicePairingID: "controller" } as any;
  const accessoryDb = {
    accessories: [
      {
        aid: 1,
        services: [
          {
            type: "4A",
            characteristics: [
              { iid: 10, type: "33" },
              { iid: 11, type: "11" },
              { iid: 12, type: "35", minStep: 0.1 },
            ],
          },
        ],
      },
    ],
  };

  function connectedClient(tempC: number) {
    return {
      getAccessories: vi.fn().mockResolvedValue(accessoryDb),
      getCharacteristics: vi.fn().mockResolvedValue({
        characteristics: [
          { iid: 10, value: 2 },
          { iid: 11, value: tempC },
          { iid: 12, value: 22 },
        ],
      }),
    };
  }

  it("rediscovers after a previously connected HAP session is refused", async () => {
    const initialClient = connectedClient(20);
    initialClient.getCharacteristics.mockResolvedValueOnce({
      characteristics: [
        { iid: 10, value: 2 },
        { iid: 11, value: 20 },
        { iid: 12, value: 22 },
      ],
    });
    initialClient.getCharacteristics.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 192.168.2.209:45317"),
    );
    const staleCachedClient = {
      getAccessories: vi
        .fn()
        .mockRejectedValue(
          new Error("connect ECONNREFUSED 192.168.2.209:45317"),
        ),
    };
    const rediscoveredClient = connectedClient(21);
    const createClient = vi
      .fn()
      .mockReturnValueOnce(initialClient)
      .mockReturnValueOnce(staleCachedClient)
      .mockReturnValueOnce(rediscoveredClient);
    const discoveryRegistry = {
      start: vi.fn(),
      lookup: vi
        .fn()
        .mockReturnValue({ address: "192.168.2.209", port: 46111 }),
      reportStaleEntry: vi.fn(),
    };
    const client = new HapControllerClient(
      "accessory-id",
      pairingData,
      "192.168.2.209",
      45317,
      undefined,
      {
        createClient: createClient as any,
        discoveryRegistry,
      },
    );

    await expect(client.getCurrentState()).resolves.toMatchObject({
      currentTempC: 20,
    });
    await expect(client.getCurrentState()).resolves.toMatchObject({
      currentTempC: 21,
    });

    expect(discoveryRegistry.reportStaleEntry).toHaveBeenCalledWith(
      "accessory-id",
    );
    expect(createClient).toHaveBeenNthCalledWith(
      3,
      "accessory-id",
      "192.168.2.209",
      46111,
      pairingData,
    );
  });
});
