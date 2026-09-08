import { describe, it, expect, vi, beforeEach } from "vitest";

const { getHomekitPairing, recordHomekitConnectionInfo } = vi.hoisted(() => ({
  getHomekitPairing: vi.fn(),
  recordHomekitConnectionInfo: vi.fn(),
}));
vi.mock("~/server/util/services/homekitPairingService", () => ({
  getHomekitPairing,
  recordHomekitConnectionInfo,
}));

const { HapControllerClientMock } = vi.hoisted(() => ({
  HapControllerClientMock: vi.fn().mockImplementation(function (
    this: any,
    ...args: unknown[]
  ) {
    this.constructedWith = args;
    this.isPaired = vi.fn();
  }),
}));
vi.mock("~/server/util/homekit/client", () => ({
  HapControllerClient: HapControllerClientMock,
}));

vi.mock("~/server/util/flair/client", () => ({
  FlairApiClient: vi.fn(),
}));

const {
  getHomeKitClientForAirHandler,
  clearHomeKitClientCache,
  getFlairClient,
  isDryRunEnv,
} = await import("~/server/control/scheduler");

beforeEach(() => {
  getHomekitPairing.mockReset();
  recordHomekitConnectionInfo.mockReset().mockResolvedValue(undefined);
  HapControllerClientMock.mockClear();
  clearHomeKitClientCache("ah-1");
  clearHomeKitClientCache("ah-2");
});

describe("isDryRunEnv", () => {
  it('fails closed: anything other than the literal string "false" means shadow mode', () => {
    const original = process.env.DRY_RUN;
    try {
      delete process.env.DRY_RUN;
      expect(isDryRunEnv()).toBe(true);
      process.env.DRY_RUN = "true";
      expect(isDryRunEnv()).toBe(true);
      process.env.DRY_RUN = "garbage";
      expect(isDryRunEnv()).toBe(true);
      process.env.DRY_RUN = "false";
      expect(isDryRunEnv()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.DRY_RUN;
      else process.env.DRY_RUN = original;
    }
  });
});

describe("getFlairClient", () => {
  it("returns the same cached instance on a second call for the same installation", () => {
    const a = getFlairClient("inst-1");
    const b = getFlairClient("inst-1");
    expect(a).toBe(b);
  });
});

describe("getHomeKitClientForAirHandler", () => {
  it("returns null when the air handler has no stored pairing", async () => {
    getHomekitPairing.mockResolvedValue(null);
    const client = await getHomeKitClientForAirHandler("ah-1");
    expect(client).toBeNull();
    expect(HapControllerClientMock).not.toHaveBeenCalled();
  });

  it("constructs a HapControllerClient from the stored pairing on first call", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairingData: { AccessoryPairingID: "x" },
      lastKnownAddress: "192.168.1.50",
      lastKnownPort: 12345,
    });
    const client = await getHomeKitClientForAirHandler("ah-1");
    expect(client).not.toBeNull();
    expect(HapControllerClientMock).toHaveBeenCalledTimes(1);
    expect(HapControllerClientMock.mock.calls[0][0]).toBe("AA:BB");
    expect(HapControllerClientMock.mock.calls[0][2]).toBe("192.168.1.50");
    expect(HapControllerClientMock.mock.calls[0][3]).toBe(12345);
  });

  it("reuses the cached client on a second call, without re-fetching the pairing", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairingData: {},
      lastKnownAddress: null,
      lastKnownPort: null,
    });
    const first = await getHomeKitClientForAirHandler("ah-1");
    const second = await getHomeKitClientForAirHandler("ah-1");
    expect(first).toBe(second);
    expect(getHomekitPairing).toHaveBeenCalledTimes(1);
    expect(HapControllerClientMock).toHaveBeenCalledTimes(1);
  });

  it("the connection-info-updated callback opportunistically records the new address/port", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairingData: {},
      lastKnownAddress: null,
      lastKnownPort: null,
    });
    await getHomeKitClientForAirHandler("ah-1");
    const onUpdated = HapControllerClientMock.mock.calls[0][4] as (
      address: string,
      port: number,
    ) => void;
    onUpdated("10.0.0.5", 9999);
    expect(recordHomekitConnectionInfo).toHaveBeenCalledWith(
      "ah-1",
      "10.0.0.5",
      9999,
    );
  });

  it("clearHomeKitClientCache forces a fresh lookup on the next call", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairingData: {},
      lastKnownAddress: null,
      lastKnownPort: null,
    });
    await getHomeKitClientForAirHandler("ah-1");
    clearHomeKitClientCache("ah-1");
    await getHomeKitClientForAirHandler("ah-1");
    expect(getHomekitPairing).toHaveBeenCalledTimes(2);
    expect(HapControllerClientMock).toHaveBeenCalledTimes(2);
  });

  it("caches per air handler independently — a different id is a real cache miss", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairingData: {},
      lastKnownAddress: null,
      lastKnownPort: null,
    });
    await getHomeKitClientForAirHandler("ah-1");
    await getHomeKitClientForAirHandler("ah-2");
    expect(getHomekitPairing).toHaveBeenCalledTimes(2);
  });
});
