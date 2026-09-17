import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";
import { EMPTY_ZONE_RUNTIME_STATE } from "~/shared/types/zone";
import { systemSettingsConfigSchema } from "~/shared/schemas/systemSettings";

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

const { getZoneById, updateZoneState } = vi.hoisted(() => ({
  getZoneById: vi.fn(),
  updateZoneState: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZoneById, updateZoneState }));

const { getSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({ getSystemSettings }));

const { router } = await import("~/server/routes/ventRecalibration");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/vent-recalibration", router);
  app.use(errorHandler);
  return app;
}

function makeZone(overrides: Record<string, unknown> = {}) {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: null,
    name: "Bedroom",
    ventHardwareType: "flair_smart_vent",
    config: {},
    state: { ...EMPTY_ZONE_RUNTIME_STATE },
    ...overrides,
  };
}

beforeEach(() => {
  getZoneById.mockReset();
  updateZoneState.mockReset().mockResolvedValue(undefined);
  getSystemSettings.mockReset().mockResolvedValue(
    systemSettingsConfigSchema.parse({
      vent_misalignment_auto_recalibration_enabled: true,
    }),
  );
});

describe("POST /api/v1/vent-recalibration/:zoneId/trigger", () => {
  it("404s for a zone that doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/missing/trigger",
    );
    expect(res.status).toBe(404);
    expect(updateZoneState).not.toHaveBeenCalled();
  });

  it("404s for a zone belonging to a different installation", async () => {
    getZoneById.mockResolvedValue(makeZone({ installationId: "other-inst" }));
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/z1/trigger",
    );
    expect(res.status).toBe(404);
  });

  it("400s when the auto-recalibration feature is disabled", async () => {
    getZoneById.mockResolvedValue(makeZone());
    getSystemSettings.mockResolvedValue(
      systemSettingsConfigSchema.parse({
        vent_misalignment_auto_recalibration_enabled: false,
      }),
    );
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/z1/trigger",
    );
    expect(res.status).toBe(400);
    expect(updateZoneState).not.toHaveBeenCalled();
  });

  it("409s when a recalibration cycle is already in progress", async () => {
    getZoneById.mockResolvedValue(
      makeZone({
        state: {
          ...EMPTY_ZONE_RUNTIME_STATE,
          vent_misalignment_recalibrating_since: new Date().toISOString(),
        },
      }),
    );
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/z1/trigger",
    );
    expect(res.status).toBe(409);
    expect(updateZoneState).not.toHaveBeenCalled();
  });

  it("records the request and responds 202 on a well-formed, idle zone", async () => {
    getZoneById.mockResolvedValue(makeZone());
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/z1/trigger",
    );
    expect(res.status).toBe(202);
    expect(updateZoneState).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        vent_manual_recalibration_requested_at: expect.any(String),
      }),
    );
  });
});

describe("POST /api/v1/vent-recalibration/:zoneId/clear-warning", () => {
  it("404s for a zone that doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/missing/clear-warning",
    );
    expect(res.status).toBe(404);
    expect(updateZoneState).not.toHaveBeenCalled();
  });

  it("resets the recalibration history and responds 204", async () => {
    getZoneById.mockResolvedValue(
      makeZone({
        state: {
          ...EMPTY_ZONE_RUNTIME_STATE,
          vent_misalignment_recalibration_history: [
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        },
      }),
    );
    const res = await request(buildApp()).post(
      "/api/v1/vent-recalibration/z1/clear-warning",
    );
    expect(res.status).toBe(204);
    expect(updateZoneState).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        vent_misalignment_recalibration_history: [],
      }),
    );
  });
});
