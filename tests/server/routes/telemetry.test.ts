import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

const { getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({ getAirHandlerById }));

const { isLokiConfigured, fetchTickDecisionHistory } = vi.hoisted(() => ({
  isLokiConfigured: vi.fn(),
  fetchTickDecisionHistory: vi.fn(),
}));
vi.mock("~/server/util/loki", () => ({
  isLokiConfigured,
  fetchTickDecisionHistory,
}));

const { router } = await import("~/server/routes/telemetry");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/telemetry", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getAirHandlerById.mockReset().mockResolvedValue({ id: "ah-1" });
  isLokiConfigured.mockReset().mockReturnValue(true);
  fetchTickDecisionHistory.mockReset().mockResolvedValue([]);
});

describe("GET /api/v1/telemetry/:airHandlerId/tick-history", () => {
  it("rejects a request missing fromMs/toMs", async () => {
    const res = await request(buildApp()).get(
      "/api/v1/telemetry/ah-1/tick-history",
    );
    expect(res.status).toBe(400);
    expect(fetchTickDecisionHistory).not.toHaveBeenCalled();
  });

  it("rejects toMs at or before fromMs", async () => {
    const res = await request(buildApp()).get(
      "/api/v1/telemetry/ah-1/tick-history?fromMs=2000&toMs=1000",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a range wider than 7 days", async () => {
    const toMs = 8 * 24 * 3600 * 1000;
    const res = await request(buildApp()).get(
      `/api/v1/telemetry/ah-1/tick-history?fromMs=0&toMs=${toMs}`,
    );
    expect(res.status).toBe(400);
  });

  it("404s for an air handler that doesn't exist", async () => {
    getAirHandlerById.mockResolvedValue(null);
    const res = await request(buildApp()).get(
      "/api/v1/telemetry/missing/tick-history?fromMs=0&toMs=1000",
    );
    expect(res.status).toBe(404);
  });

  it("503s when Loki isn't configured", async () => {
    isLokiConfigured.mockReturnValue(false);
    const res = await request(buildApp()).get(
      "/api/v1/telemetry/ah-1/tick-history?fromMs=0&toMs=1000",
    );
    expect(res.status).toBe(503);
    expect(fetchTickDecisionHistory).not.toHaveBeenCalled();
  });

  it("returns points from Loki with the given range/limit", async () => {
    const points = [{ loggedAtMs: 500, decision: { air_handler_id: "ah-1" } }];
    fetchTickDecisionHistory.mockResolvedValue(points);
    const res = await request(buildApp()).get(
      "/api/v1/telemetry/ah-1/tick-history?fromMs=0&toMs=1000&limit=50",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ points });
    expect(fetchTickDecisionHistory).toHaveBeenCalledWith("ah-1", 0, 1000, 50);
  });

  it("defaults the limit when not given", async () => {
    await request(buildApp()).get(
      "/api/v1/telemetry/ah-1/tick-history?fromMs=0&toMs=1000",
    );
    expect(fetchTickDecisionHistory).toHaveBeenCalledWith("ah-1", 0, 1000, 500);
  });
});
