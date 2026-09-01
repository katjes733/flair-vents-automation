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

const { getAirHandlersForInstallation, getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlersForInstallation: vi.fn(),
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({
  getAirHandlersForInstallation,
  getAirHandlerById,
}));

const { createAirHandlerForInstallation, updateAirHandlerWithValidation } =
  vi.hoisted(() => ({
    createAirHandlerForInstallation: vi.fn(),
    updateAirHandlerWithValidation: vi.fn(),
  }));
vi.mock("~/server/util/services/airHandlerService", () => ({
  createAirHandlerForInstallation,
  updateAirHandlerWithValidation,
}));

const { getCachedTickDecision } = vi.hoisted(() => ({
  getCachedTickDecision: vi.fn(),
}));
vi.mock("~/server/control/tickDecision", () => ({ getCachedTickDecision }));

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
  getCachedTickDecision.mockReset();
});

describe("GET /api/v1/air-handlers", () => {
  it("lists every air handler for the installation", async () => {
    getAirHandlersForInstallation.mockResolvedValue([{ id: "ah-1" }]);
    const res = await request(buildApp()).get("/api/v1/air-handlers");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "ah-1" }]);
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
