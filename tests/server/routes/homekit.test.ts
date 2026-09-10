import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = {
      loginEmail: "a@example.com",
      source: "member",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
    };
    next();
  },
}));
vi.mock("~/server/middleware/requirePermission", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const { getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({ getAirHandlerById }));

const { getZonesForAirHandler } = vi.hoisted(() => ({
  getZonesForAirHandler: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForAirHandler }));

const { getHomekitPairing, storeHomekitPairing, deleteHomekitPairing } =
  vi.hoisted(() => ({
    getHomekitPairing: vi.fn(),
    storeHomekitPairing: vi.fn(),
    deleteHomekitPairing: vi.fn(),
  }));
vi.mock("~/server/util/services/homekitPairingService", () => ({
  getHomekitPairing,
  storeHomekitPairing,
  deleteHomekitPairing,
}));

const { getHomeKitClientForAirHandler, clearHomeKitClientCache, fakeClient } =
  vi.hoisted(() => ({
    getHomeKitClientForAirHandler: vi.fn(),
    clearHomeKitClientCache: vi.fn(),
    fakeClient: {
      isPaired: vi.fn(),
      removePairing: vi.fn(),
      getSensorReadings: vi.fn(),
    },
  }));
vi.mock("~/server/control/scheduler", () => ({
  getHomeKitClientForAirHandler,
  clearHomeKitClientCache,
}));

const { pairHomeKitAccessory, discoverUnpairedAccessories } = vi.hoisted(
  () => ({
    pairHomeKitAccessory: vi.fn(),
    discoverUnpairedAccessories: vi.fn(),
  }),
);
vi.mock("~/server/util/homekit/client", () => ({
  pairHomeKitAccessory,
  discoverUnpairedAccessories,
}));

const { router } = await import("~/server/routes/homekit");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/air-handlers", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getAirHandlerById.mockReset().mockResolvedValue({
    id: "ah-1",
    installationId: "inst-1",
    name: "Upstairs",
  });
  getHomekitPairing.mockReset();
  storeHomekitPairing.mockReset().mockResolvedValue(undefined);
  deleteHomekitPairing.mockReset().mockResolvedValue(undefined);
  getHomeKitClientForAirHandler.mockReset().mockResolvedValue(fakeClient);
  clearHomeKitClientCache.mockReset();
  fakeClient.isPaired.mockReset().mockResolvedValue(true);
  fakeClient.removePairing.mockReset().mockResolvedValue(undefined);
  fakeClient.getSensorReadings.mockReset().mockResolvedValue(new Map());
  pairHomeKitAccessory.mockReset();
  discoverUnpairedAccessories.mockReset();
  getZonesForAirHandler.mockReset().mockResolvedValue([]);
});

describe("GET /:id/homekit/status", () => {
  it("reports unpaired when no pairing row exists", async () => {
    getHomekitPairing.mockResolvedValue(null);
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/homekit/status",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paired: false });
  });

  it("reports paired + reachable when a pairing exists and the client connects", async () => {
    getHomekitPairing.mockResolvedValue({
      accessoryId: "AA:BB",
      pairedAt: "2024-01-01T00:00:00.000Z",
      lastConnectError: null,
      lastConnectErrorAt: null,
    });
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/homekit/status",
    );
    expect(res.status).toBe(200);
    expect(res.body.paired).toBe(true);
    expect(res.body.reachable).toBe(true);
  });

  it("404s for an air handler belonging to a different installation", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-OTHER",
    });
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/homekit/status",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/homekit/discover", () => {
  it("returns the currently-discoverable unpaired accessories", async () => {
    discoverUnpairedAccessories.mockResolvedValue([
      { name: "Upstairs", accessoryId: "AA:BB:CC" },
    ]);
    const res = await request(buildApp()).post(
      "/api/v1/air-handlers/ah-1/homekit/discover",
    );
    expect(res.status).toBe(200);
    expect(res.body.accessories).toEqual([
      { name: "Upstairs", accessoryId: "AA:BB:CC" },
    ]);
  });
});

describe("POST /:id/homekit/pair", () => {
  it("rejects a malformed setup code before attempting to pair", async () => {
    const res = await request(buildApp())
      .post("/api/v1/air-handlers/ah-1/homekit/pair")
      .send({ accessoryId: "AA:BB", setupCode: "12345678" });
    expect(res.status).toBe(400);
    expect(pairHomeKitAccessory).not.toHaveBeenCalled();
  });

  it("pairs, stores the result, and clears the client cache", async () => {
    pairHomeKitAccessory.mockResolvedValue({
      pairingData: { AccessoryPairingID: "x" },
      address: "192.168.1.50",
      port: 12345,
    });
    const res = await request(buildApp())
      .post("/api/v1/air-handlers/ah-1/homekit/pair")
      .send({ accessoryId: "AA:BB", setupCode: "123-45-678" });
    expect(res.status).toBe(200);
    expect(storeHomekitPairing).toHaveBeenCalledWith(
      expect.objectContaining({ airHandlerId: "ah-1", accessoryId: "AA:BB" }),
    );
    expect(clearHomeKitClientCache).toHaveBeenCalledWith("ah-1");
  });
});

describe("POST /:id/homekit/unpair", () => {
  it("calls the real device's removePairing before deleting the stored row", async () => {
    const callOrder: string[] = [];
    fakeClient.removePairing.mockImplementation(async () => {
      callOrder.push("removePairing");
    });
    deleteHomekitPairing.mockImplementation(async () => {
      callOrder.push("deleteHomekitPairing");
    });

    const res = await request(buildApp()).post(
      "/api/v1/air-handlers/ah-1/homekit/unpair",
    );

    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["removePairing", "deleteHomekitPairing"]);
    expect(clearHomeKitClientCache).toHaveBeenCalledWith("ah-1");
  });

  it("still deletes the stored row even if there was no live client to remove from", async () => {
    getHomeKitClientForAirHandler.mockResolvedValue(null);
    const res = await request(buildApp()).post(
      "/api/v1/air-handlers/ah-1/homekit/unpair",
    );
    expect(res.status).toBe(200);
    expect(deleteHomekitPairing).toHaveBeenCalledWith("ah-1");
  });
});

describe("GET /:id/homekit/sensor-matches", () => {
  it("returns an empty match list for an unpaired air handler, not an error", async () => {
    getHomeKitClientForAirHandler.mockResolvedValue(null);
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/homekit/sensor-matches",
    );
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });

  it("computes matches by cross-referencing live sensor readings against this air handler's zones", async () => {
    fakeClient.getSensorReadings.mockResolvedValue(
      new Map([
        [
          "Y3H2",
          { serial: "Y3H2", name: "Martin Office", tempC: 22, occupied: true },
        ],
      ]),
    );
    getZonesForAirHandler.mockResolvedValue([
      {
        id: "z1",
        name: "Martin Office",
        config: { homekit_sensor_serial: null },
      },
    ]);
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/homekit/sensor-matches",
    );
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([
      {
        kind: "unmapped_suggested",
        serial: "Y3H2",
        name: "Martin Office",
        tempC: 22,
        occupied: true,
        suggestedZoneId: "z1",
        suggestedZoneName: "Martin Office",
      },
    ]);
  });
});
