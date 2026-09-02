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

const { updateSettingsForInstallation } = vi.hoisted(() => ({
  updateSettingsForInstallation: vi.fn(),
}));
vi.mock("~/server/util/services/settingsService", () => ({
  updateSettingsForInstallation,
}));

const { triggerImmediateTick } = vi.hoisted(() => ({
  triggerImmediateTick: vi.fn(),
}));
vi.mock("~/server/control/scheduler", () => ({ triggerImmediateTick }));

const { router } = await import("~/server/routes/control");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/control", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  updateSettingsForInstallation.mockReset().mockResolvedValue({
    config: {},
    warnings: [],
  });
  triggerImmediateTick.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/v1/control/disarm", () => {
  it("rejects a missing actor", async () => {
    const res = await request(buildApp())
      .post("/api/v1/control/disarm")
      .send({});
    expect(res.status).toBe(400);
    expect(updateSettingsForInstallation).not.toHaveBeenCalled();
  });

  it("sets control_disarmed true with a valid actor", async () => {
    const res = await request(buildApp())
      .post("/api/v1/control/disarm")
      .send({ actor: "Martin" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ control_disarmed: true });
    expect(updateSettingsForInstallation).toHaveBeenCalledWith("inst-1", {
      control_disarmed: true,
    });
  });
});

describe("POST /api/v1/control/rearm", () => {
  it("sets control_disarmed false with a valid actor", async () => {
    const res = await request(buildApp())
      .post("/api/v1/control/rearm")
      .send({ actor: "Martin" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ control_disarmed: false });
    expect(updateSettingsForInstallation).toHaveBeenCalledWith("inst-1", {
      control_disarmed: false,
    });
  });
});

describe("POST /api/v1/control/trigger-tick", () => {
  it("runs an immediate tick cycle and returns 200", async () => {
    const res = await request(buildApp()).post("/api/v1/control/trigger-tick");
    expect(res.status).toBe(200);
    expect(triggerImmediateTick).toHaveBeenCalledOnce();
  });
});
