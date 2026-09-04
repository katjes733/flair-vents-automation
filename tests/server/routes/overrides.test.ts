import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";
import { HttpError } from "~/server/util/httpError";

const { getOrCreateDefaultInstallation } = vi.hoisted(() => ({
  getOrCreateDefaultInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getOrCreateDefaultInstallation,
}));

const { getZonesForInstallation } = vi.hoisted(() => ({
  getZonesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForInstallation }));

const {
  createOverrideForZone,
  revokeOverride,
  getLatestOverridesForZones,
  getOverrideHistoryForZone,
} = vi.hoisted(() => ({
  createOverrideForZone: vi.fn(),
  revokeOverride: vi.fn(),
  getLatestOverridesForZones: vi.fn(),
  getOverrideHistoryForZone: vi.fn(),
}));
vi.mock("~/server/util/services/overrideService", () => ({
  createOverrideForZone,
  revokeOverride,
  getLatestOverridesForZones,
  getOverrideHistoryForZone,
}));

const { router } = await import("~/server/routes/overrides");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/overrides", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  getZonesForInstallation.mockReset().mockResolvedValue([{ id: "z1" }]);
  createOverrideForZone.mockReset();
  revokeOverride.mockReset();
  getLatestOverridesForZones.mockReset();
  getOverrideHistoryForZone.mockReset();
});

describe("GET /api/v1/overrides", () => {
  it("marks a not-yet-expired, not-revoked override as active", async () => {
    getLatestOverridesForZones.mockResolvedValue(
      new Map([
        [
          "z1",
          {
            zoneId: "z1",
            config: {
              kind: "position",
              value: 50,
              hold_type: "permanent",
              actor: "Martin",
            },
            expiresAtMs: null,
            revokedAtMs: null,
          },
        ],
      ]),
    );
    const res = await request(buildApp()).get("/api/v1/overrides");
    expect(res.status).toBe(200);
    expect(res.body[0].active).toBe(true);
  });

  it("marks a revoked override as not active", async () => {
    getLatestOverridesForZones.mockResolvedValue(
      new Map([
        [
          "z1",
          {
            zoneId: "z1",
            config: {
              kind: "position",
              value: 50,
              hold_type: "permanent",
              actor: "Martin",
            },
            expiresAtMs: null,
            revokedAtMs: Date.now() - 1000,
          },
        ],
      ]),
    );
    const res = await request(buildApp()).get("/api/v1/overrides");
    expect(res.body[0].active).toBe(false);
  });
});

describe("POST /api/v1/overrides", () => {
  it("rejects a missing actor", async () => {
    const res = await request(buildApp()).post("/api/v1/overrides").send({
      kind: "position",
      zone_id: "11111111-1111-4111-8111-111111111111",
      value: 50,
      hold_type: "2h",
    });
    expect(res.status).toBe(400);
    expect(createOverrideForZone).not.toHaveBeenCalled();
  });

  it("rejects a position value out of range", async () => {
    const res = await request(buildApp()).post("/api/v1/overrides").send({
      kind: "position",
      zone_id: "11111111-1111-4111-8111-111111111111",
      value: 150,
      hold_type: "2h",
      actor: "Martin",
    });
    expect(res.status).toBe(400);
  });

  it("creates with a well-formed body", async () => {
    createOverrideForZone.mockResolvedValue({ id: "mo-1" });
    const res = await request(buildApp()).post("/api/v1/overrides").send({
      kind: "position",
      zone_id: "11111111-1111-4111-8111-111111111111",
      value: 50,
      hold_type: "2h",
      actor: "Martin",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "mo-1" });
  });
});

describe("POST /api/v1/overrides/:id/revoke", () => {
  it("revokes and returns 204", async () => {
    revokeOverride.mockResolvedValue(undefined);
    const res = await request(buildApp()).post("/api/v1/overrides/mo-1/revoke");
    expect(res.status).toBe(204);
    expect(revokeOverride).toHaveBeenCalledWith("mo-1");
  });
});

describe("GET /api/v1/overrides/:zoneId/history", () => {
  it("rejects a request missing fromMs/toMs", async () => {
    const res = await request(buildApp()).get("/api/v1/overrides/z1/history");
    expect(res.status).toBe(400);
    expect(getOverrideHistoryForZone).not.toHaveBeenCalled();
  });

  it("rejects toMs at or before fromMs", async () => {
    const res = await request(buildApp()).get(
      "/api/v1/overrides/z1/history?fromMs=2000&toMs=1000",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a range wider than 7 days", async () => {
    const toMs = 8 * 24 * 3600 * 1000;
    const res = await request(buildApp()).get(
      `/api/v1/overrides/z1/history?fromMs=0&toMs=${toMs}`,
    );
    expect(res.status).toBe(400);
  });

  it("404s for a zone that doesn't exist", async () => {
    getOverrideHistoryForZone.mockRejectedValue(
      new HttpError("Zone missing not found.", 404),
    );
    const res = await request(buildApp()).get(
      "/api/v1/overrides/missing/history?fromMs=0&toMs=1000",
    );
    expect(res.status).toBe(404);
  });

  it("returns the zone's override history for the given range", async () => {
    getOverrideHistoryForZone.mockResolvedValue([{ id: "mo-1" }]);
    const res = await request(buildApp()).get(
      "/api/v1/overrides/z1/history?fromMs=0&toMs=1000",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "mo-1" }]);
    expect(getOverrideHistoryForZone).toHaveBeenCalledWith("z1", 0, 1000);
  });
});
