import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";
import { resolveSystemSettings } from "~/shared/schemas/systemSettings";

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

const { getSystemSettings, updateSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({
  getSystemSettings,
  updateSystemSettings,
}));

const { getZonesForInstallation } = vi.hoisted(() => ({
  getZonesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForInstallation }));

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
  getSystemSettings.mockReset();
  updateSystemSettings.mockReset().mockResolvedValue(undefined);
  getZonesForInstallation.mockReset().mockResolvedValue([]);
  updateSettingsForInstallation.mockReset();
});

describe("GET /api/v1/settings", () => {
  it("returns the resolved config for the caller's own installation", async () => {
    getSystemSettings.mockResolvedValue(resolveSystemSettings({}));
    const res = await request(buildApp()).get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(res.body.control_tick_interval_seconds).toBe(60);
    expect(getSystemSettings).toHaveBeenCalledWith("inst-1");
  });

  // Regression coverage: a zone deleted-and-recreated leaves its old id
  // dangling in zone_priority_order forever, since the priority-order UI
  // only supports reordering, not removing a single entry — self-healing
  // on read (not only on the next settings save) is what actually clears
  // it without requiring an unrelated save first.
  const STALE_ZONE_ID = "11111111-1111-4111-8111-111111111111";
  const Z1_ID = "22222222-2222-4222-8222-222222222222";

  it("self-heals a stale zone id out of zone_priority_order and persists the reconciled list", async () => {
    getSystemSettings.mockResolvedValue(
      resolveSystemSettings({
        zone_priority_order: [STALE_ZONE_ID, Z1_ID],
      }),
    );
    getZonesForInstallation.mockResolvedValue([{ id: Z1_ID, name: "Zone 1" }]);
    const res = await request(buildApp()).get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(res.body.zone_priority_order).toEqual([Z1_ID]);
    expect(updateSystemSettings).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ zone_priority_order: [Z1_ID] }),
    );
  });

  it("does not re-save settings when zone_priority_order is already in sync", async () => {
    getSystemSettings.mockResolvedValue(
      resolveSystemSettings({ zone_priority_order: [Z1_ID] }),
    );
    getZonesForInstallation.mockResolvedValue([{ id: Z1_ID, name: "Zone 1" }]);
    const res = await request(buildApp()).get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(updateSystemSettings).not.toHaveBeenCalled();
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

  // Regression test: a genuinely minimal patch (just the Settings page's
  // temperature-unit toggle, the same shape the reorder feature's
  // display_order patch exposed for zoneConfigSchema) previously reached
  // the service layer with every other setting silently reintroduced at
  // its Zod default — systemSettingsConfigSchema.partial() alone doesn't
  // suppress .default() for an omitted key. Asserting on exactly what
  // reaches updateSettingsForInstallation — not just the response status
  // — is what actually exercises the fix
  // (systemSettingsConfigPartialSchema), since the service call itself is
  // mocked here.
  it("passes only the given field through, not every field at its default", async () => {
    updateSettingsForInstallation.mockResolvedValue({
      config: resolveSystemSettings({ display_temperature_unit: "F" }),
      warnings: [],
    });
    const res = await request(buildApp())
      .patch("/api/v1/settings")
      .send({ display_temperature_unit: "F" });
    expect(res.status).toBe(200);
    expect(updateSettingsForInstallation).toHaveBeenCalledWith("inst-1", {
      display_temperature_unit: "F",
    });
  });
});
