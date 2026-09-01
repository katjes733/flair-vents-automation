import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

const { getOrCreateDefaultInstallation } = vi.hoisted(() => ({
  getOrCreateDefaultInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getOrCreateDefaultInstallation,
}));

const { getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({ getAirHandlerById }));

const { getSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({ getSystemSettings }));

const { createRedisAlertingClient } = vi.hoisted(() => ({
  createRedisAlertingClient: vi.fn(),
}));
vi.mock("~/server/util/alerting", () => ({ createRedisAlertingClient }));

const { getFlairClient } = vi.hoisted(() => ({ getFlairClient: vi.fn() }));
vi.mock("~/server/control/scheduler", () => ({ getFlairClient }));

const { fetchSyncCandidates } = vi.hoisted(() => ({
  fetchSyncCandidates: vi.fn(),
}));
vi.mock("~/server/util/flair/resources", () => ({ fetchSyncCandidates }));

const { runSync, linkRoomToZone, createZoneFromRoom } = vi.hoisted(() => ({
  runSync: vi.fn(),
  linkRoomToZone: vi.fn(),
  createZoneFromRoom: vi.fn(),
}));
vi.mock("~/server/util/services/syncService", () => ({
  runSync,
  linkRoomToZone,
  createZoneFromRoom,
}));

const { router } = await import("~/server/routes/sync");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/sync", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1", flairStructureId: "s1" });
  getAirHandlerById
    .mockReset()
    .mockResolvedValue({ id: "ah-1", flairZoneId: "fz1" });
  getSystemSettings
    .mockReset()
    .mockResolvedValue({ email_rate_floor_minutes: 15 });
  createRedisAlertingClient.mockReset().mockReturnValue({});
  getFlairClient.mockReset().mockReturnValue({});
  fetchSyncCandidates.mockReset();
  runSync.mockReset();
  linkRoomToZone.mockReset();
  createZoneFromRoom.mockReset();
});

describe("POST /api/v1/sync/:airHandlerId/run", () => {
  it("404s for an unknown air handler", async () => {
    getAirHandlerById.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/v1/sync/missing/run");
    expect(res.status).toBe(404);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("400s when the air handler has no Flair zone linked yet", async () => {
    getAirHandlerById.mockResolvedValue({ id: "ah-1", flairZoneId: null });
    const res = await request(buildApp()).post("/api/v1/sync/ah-1/run");
    expect(res.status).toBe(400);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("runs sync and returns the result", async () => {
    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    const res = await request(buildApp()).post("/api/v1/sync/ah-1/run");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: [], unmatched: [] });
    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        airHandlerId: "ah-1",
        structureId: "s1",
        flairZoneId: "fz1",
        rateFloorMinutes: 15,
      }),
    );
  });
});

describe("POST /api/v1/sync/:airHandlerId/link", () => {
  it("400s when the room isn't currently visible on this air handler", async () => {
    fetchSyncCandidates.mockResolvedValue([]);
    const res = await request(buildApp()).post("/api/v1/sync/ah-1/link").send({
      flair_room_id: "room-1",
      zone_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.status).toBe(400);
    expect(linkRoomToZone).not.toHaveBeenCalled();
  });

  it("links the room to the given zone", async () => {
    fetchSyncCandidates.mockResolvedValue([
      {
        flairRoomId: "room-1",
        name: "Bedroom",
        liveVentIds: ["vent-1"],
        hasTemperatureSensor: true,
        hasOccupancySensor: false,
      },
    ]);
    linkRoomToZone.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    const res = await request(buildApp()).post("/api/v1/sync/ah-1/link").send({
      flair_room_id: "room-1",
      zone_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.status).toBe(200);
    expect(linkRoomToZone).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });
});

describe("POST /api/v1/sync/:airHandlerId/create", () => {
  it("creates a zone from the room's live data", async () => {
    fetchSyncCandidates.mockResolvedValue([
      {
        flairRoomId: "room-1",
        name: "Bedroom",
        liveVentIds: ["vent-1"],
        hasTemperatureSensor: true,
        hasOccupancySensor: false,
      },
    ]);
    createZoneFromRoom.mockResolvedValue({ id: "z1" });
    const res = await request(buildApp())
      .post("/api/v1/sync/ah-1/create")
      .send({ flair_room_id: "room-1" });
    expect(res.status).toBe(201);
    expect(createZoneFromRoom).toHaveBeenCalledWith(
      expect.objectContaining({ airHandlerId: "ah-1" }),
    );
  });
});
