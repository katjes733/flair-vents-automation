import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";
import { resolveSystemSettings } from "~/shared/schemas/systemSettings";

const { getOrCreateDefaultInstallation } = vi.hoisted(() => ({
  getOrCreateDefaultInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getOrCreateDefaultInstallation,
}));

const { getSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({ getSystemSettings }));

const { updateSettingsForInstallation } = vi.hoisted(() => ({
  updateSettingsForInstallation: vi.fn(),
}));
vi.mock("~/server/util/services/settingsService", () => ({
  updateSettingsForInstallation,
}));

const { router } = await import("~/server/routes/settings");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/settings", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  getSystemSettings.mockReset();
  updateSettingsForInstallation.mockReset();
});

describe("GET /api/v1/settings", () => {
  it("returns the resolved config", async () => {
    getSystemSettings.mockResolvedValue(resolveSystemSettings({}));
    const res = await request(buildApp()).get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(res.body.control_tick_interval_seconds).toBe(60);
  });
});

describe("PATCH /api/v1/settings", () => {
  it("rejects an out-of-range field", async () => {
    const res = await request(buildApp())
      .patch("/api/v1/settings")
      .send({ token_budget_alert_threshold_pct: 500 });
    expect(res.status).toBe(400);
    expect(updateSettingsForInstallation).not.toHaveBeenCalled();
  });

  it("accepts a well-formed partial update", async () => {
    updateSettingsForInstallation.mockResolvedValue({
      config: resolveSystemSettings({ home_timezone: "America/Denver" }),
      warnings: [],
    });
    const res = await request(buildApp())
      .patch("/api/v1/settings")
      .send({ home_timezone: "America/Denver" });
    expect(res.status).toBe(200);
    expect(res.body.config.home_timezone).toBe("America/Denver");
    expect(res.body.warnings).toEqual([]);
  });
});
