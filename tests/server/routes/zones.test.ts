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

const { getZonesForInstallation, getZoneById } = vi.hoisted(() => ({
  getZonesForInstallation: vi.fn(),
  getZoneById: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({
  getZonesForInstallation,
  getZoneById,
}));

const {
  createZoneForInstallation,
  updateZoneWithValidation,
  deleteZoneWithValidation,
} = vi.hoisted(() => ({
  createZoneForInstallation: vi.fn(),
  updateZoneWithValidation: vi.fn(),
  deleteZoneWithValidation: vi.fn(),
}));
vi.mock("~/server/util/services/zoneService", () => ({
  createZoneForInstallation,
  updateZoneWithValidation,
  deleteZoneWithValidation,
}));

const { router } = await import("~/server/routes/zones");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/zones", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  getZonesForInstallation.mockReset();
  getZoneById.mockReset();
  createZoneForInstallation.mockReset();
  updateZoneWithValidation.mockReset();
  deleteZoneWithValidation.mockReset();
});

describe("GET /api/v1/zones", () => {
  it("lists every zone for the installation", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1" }]);
    const res = await request(buildApp()).get("/api/v1/zones");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "z1" }]);
  });
});

describe("GET /api/v1/zones/:id", () => {
  it("404s when not found", async () => {
    getZoneById.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/zones/missing");
    expect(res.status).toBe(404);
  });

  it("returns the zone when found", async () => {
    getZoneById.mockResolvedValue({ id: "z1" });
    const res = await request(buildApp()).get("/api/v1/zones/z1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "z1" });
  });
});

describe("POST /api/v1/zones", () => {
  it("rejects an invalid body (bad enum value)", async () => {
    const res = await request(buildApp()).post("/api/v1/zones").send({
      air_handler_id: "ah-1",
      name: "Office",
      vent_hardware_type: "not_a_real_type",
    });
    expect(res.status).toBe(400);
    expect(createZoneForInstallation).not.toHaveBeenCalled();
  });

  it("rejects a missing air_handler_id (not a uuid)", async () => {
    const res = await request(buildApp()).post("/api/v1/zones").send({
      name: "Office",
      vent_hardware_type: "flair_smart_vent",
    });
    expect(res.status).toBe(400);
  });

  it("creates a zone with a well-formed body", async () => {
    createZoneForInstallation.mockResolvedValue({ id: "z1" });
    const res = await request(buildApp()).post("/api/v1/zones").send({
      air_handler_id: "11111111-1111-4111-8111-111111111111",
      name: "Office",
      vent_hardware_type: "flair_smart_vent",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "z1" });
    expect(createZoneForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        name: "Office",
      }),
    );
  });
});

describe("PATCH /api/v1/zones/:id", () => {
  it("propagates a service-layer rejection (e.g. not found) as the same status", async () => {
    const { HttpError } = await import("~/server/util/httpError");
    updateZoneWithValidation.mockRejectedValue(
      new HttpError("Zone missing not found.", 404),
    );
    const res = await request(buildApp())
      .patch("/api/v1/zones/missing")
      .send({ name: "New name" });
    expect(res.status).toBe(404);
  });

  it("updates with a well-formed partial body", async () => {
    updateZoneWithValidation.mockResolvedValue({ id: "z1", name: "New name" });
    const res = await request(buildApp())
      .patch("/api/v1/zones/z1")
      .send({ name: "New name" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "z1", name: "New name" });
  });

  // Regression test: a genuinely minimal config patch (just
  // display_order, the reorder feature's own request shape) previously
  // reached the service layer with every other config field silently
  // reintroduced at its Zod default — `zoneConfigSchema.partial()` alone
  // doesn't suppress `.default()` for an omitted key. Confirmed live: a
  // zone-card reorder on a real multi-vent zone failed with "requires at
  // least one flair_vent_id" once that defaulted `flair_vent_ids: []`
  // got merged onto the existing row. Asserting on exactly what reaches
  // `updateZoneWithValidation` — not just the response status — is what
  // actually exercises the fixed schema (`zoneConfigPartialSchema`),
  // since the service call itself is mocked here.
  it("passes only the given config field through, not every field at its default", async () => {
    updateZoneWithValidation.mockResolvedValue({ id: "z1" });
    const res = await request(buildApp())
      .patch("/api/v1/zones/z1")
      .send({ config: { display_order: 1 } });
    expect(res.status).toBe(200);
    expect(updateZoneWithValidation).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({ config: { display_order: 1 } }),
    );
  });

  // The zone-level duct_flow_rate_lps field this null-sentinel regression
  // test was written against (originally assumed_fixed_position before
  // that) is retired entirely — see "Multi-Vent Manual Zones": both
  // manual_fixed_vent and flair_smart_vent zones now carry their rating
  // per vent, and there's no top-level field left needing this exact
  // clearing treatment. The general null-sentinel mechanism itself stays
  // covered schema-agnostically in zodPartial.test.ts.
});

describe("DELETE /api/v1/zones/:id", () => {
  it("deletes and returns 204", async () => {
    deleteZoneWithValidation.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete("/api/v1/zones/z1");
    expect(res.status).toBe(204);
  });
});
