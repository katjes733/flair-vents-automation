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

const { getAirHandlersForInstallation, getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlersForInstallation: vi.fn(),
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({
  getAirHandlersForInstallation,
  getAirHandlerById,
}));

const {
  createAirHandlerForInstallation,
  updateAirHandlerWithValidation,
  deleteAirHandlerWithValidation,
} = vi.hoisted(() => ({
  createAirHandlerForInstallation: vi.fn(),
  updateAirHandlerWithValidation: vi.fn(),
  deleteAirHandlerWithValidation: vi.fn(),
}));
vi.mock("~/server/util/services/airHandlerService", () => ({
  createAirHandlerForInstallation,
  updateAirHandlerWithValidation,
  deleteAirHandlerWithValidation,
}));

const { getCachedTickDecision } = vi.hoisted(() => ({
  getCachedTickDecision: vi.fn(),
}));
vi.mock("~/server/control/tickDecision", () => ({ getCachedTickDecision }));

const { getFlairClient, fetchZones } = vi.hoisted(() => ({
  getFlairClient: vi.fn(),
  fetchZones: vi.fn(),
}));
vi.mock("~/server/control/scheduler", () => ({ getFlairClient }));

const { ensureFlairStructureLinked } = vi.hoisted(() => ({
  ensureFlairStructureLinked: vi.fn(),
}));
vi.mock("~/server/util/services/installationService", () => ({
  ensureFlairStructureLinked,
}));

const { router } = await import("~/server/routes/airHandlers");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/air-handlers", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  getAirHandlersForInstallation.mockReset();
  getAirHandlerById.mockReset();
  createAirHandlerForInstallation.mockReset();
  updateAirHandlerWithValidation.mockReset();
  deleteAirHandlerWithValidation.mockReset();
  getCachedTickDecision.mockReset();
  getFlairClient.mockReset();
  fetchZones.mockReset();
  ensureFlairStructureLinked.mockReset();
});

describe("GET /api/v1/air-handlers", () => {
  it("lists every air handler for the installation", async () => {
    getAirHandlersForInstallation.mockResolvedValue([{ id: "ah-1" }]);
    const res = await request(buildApp()).get("/api/v1/air-handlers");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "ah-1" }]);
  });
});

describe("GET /api/v1/air-handlers/flair-zones", () => {
  beforeEach(() => {
    getFlairClient.mockReturnValue({ fetchZones });
    getOrCreateDefaultInstallation.mockResolvedValue({
      id: "inst-1",
      flairStructureId: null,
    });
  });

  it("400s when auto-linking finds no Flair structure on the account", async () => {
    ensureFlairStructureLinked.mockRejectedValue(
      new HttpError("No Flair structures found on this account.", 400),
    );
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/flair-zones",
    );
    expect(res.status).toBe(400);
    expect(fetchZones).not.toHaveBeenCalled();
  });

  it("marks a zone already assigned to another air handler, by name", async () => {
    ensureFlairStructureLinked.mockResolvedValue({
      id: "inst-1",
      flairStructureId: "s1",
    });
    fetchZones.mockResolvedValue([
      { id: "fz-1", structureId: "s1", name: "Upstairs", thermostatId: null },
      { id: "fz-2", structureId: "s1", name: "Downstairs", thermostatId: null },
    ]);
    getAirHandlersForInstallation.mockResolvedValue([
      { id: "ah-1", name: "Main Floor", flairZoneId: "fz-2" },
    ]);
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/flair-zones",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "fz-1",
        name: "Upstairs",
        assignedAirHandlerId: null,
        assignedAirHandlerName: null,
      },
      {
        id: "fz-2",
        name: "Downstairs",
        assignedAirHandlerId: "ah-1",
        assignedAirHandlerName: "Main Floor",
      },
    ]);
  });
});

describe("GET /api/v1/air-handlers/:id", () => {
  it("404s when not found", async () => {
    getAirHandlerById.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/air-handlers/missing");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/air-handlers", () => {
  it("requires a name", async () => {
    const res = await request(buildApp()).post("/api/v1/air-handlers").send({});
    expect(res.status).toBe(400);
  });

  it("creates with a well-formed body", async () => {
    createAirHandlerForInstallation.mockResolvedValue({ id: "ah-1" });
    const res = await request(buildApp())
      .post("/api/v1/air-handlers")
      .send({ name: "Upstairs" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "ah-1" });
  });
});

describe("PATCH /api/v1/air-handlers/:id", () => {
  it("updates with a well-formed partial body", async () => {
    updateAirHandlerWithValidation.mockResolvedValue({
      id: "ah-1",
      active: true,
    });
    const res = await request(buildApp())
      .patch("/api/v1/air-handlers/ah-1")
      .send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "ah-1", active: true });
  });
});

describe("DELETE /api/v1/air-handlers/:id", () => {
  it("deletes and returns 204", async () => {
    deleteAirHandlerWithValidation.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete("/api/v1/air-handlers/ah-1");
    expect(res.status).toBe(204);
    expect(deleteAirHandlerWithValidation).toHaveBeenCalledWith("ah-1");
  });

  it("propagates a 409 when zones still reference it", async () => {
    deleteAirHandlerWithValidation.mockRejectedValue(
      new HttpError("still has zone(s): Bedroom", 409),
    );
    const res = await request(buildApp()).delete("/api/v1/air-handlers/ah-1");
    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/air-handlers/:id/tick-decision", () => {
  it("404s before the handler has ever ticked", async () => {
    getCachedTickDecision.mockReturnValue(null);
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/tick-decision",
    );
    expect(res.status).toBe(404);
  });

  it("returns the cached decision", async () => {
    getCachedTickDecision.mockReturnValue({ air_handler_id: "ah-1" });
    const res = await request(buildApp()).get(
      "/api/v1/air-handlers/ah-1/tick-decision",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ air_handler_id: "ah-1" });
  });
});
