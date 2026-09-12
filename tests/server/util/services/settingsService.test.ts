import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSystemSettings } from "~/shared/schemas/systemSettings";

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

const { redisDel } = vi.hoisted(() => ({ redisDel: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { del: redisDel } }));

const { updateSettingsForInstallation } =
  await import("~/server/util/services/settingsService");

describe("updateSettingsForInstallation", () => {
  beforeEach(() => {
    getSystemSettings.mockReset().mockResolvedValue(resolveSystemSettings({}));
    updateSystemSettings.mockReset().mockResolvedValue(undefined);
    getZonesForInstallation.mockReset().mockResolvedValue([]);
    redisDel.mockReset().mockResolvedValue(1);
  });

  it("merges the patch onto the existing config", async () => {
    const result = await updateSettingsForInstallation("inst-1", {
      home_timezone: "America/Denver",
    });
    expect(result.config.home_timezone).toBe("America/Denver");
    expect(updateSystemSettings).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ home_timezone: "America/Denver" }),
    );
  });

  it("surfaces the step-delta deadlock as a warning, not a rejection", async () => {
    const result = await updateSettingsForInstallation("inst-1", {
      min_step_delta_pct: 50,
      modulation_step_pct: 10,
      max_steps_per_tick: 1,
    });
    expect(result.warnings.some((w) => w.includes("min_step_delta_pct"))).toBe(
      true,
    );
    expect(updateSystemSettings).toHaveBeenCalledOnce();
  });

  // Self-heals rather than rejecting: the priority-order UI only supports
  // reordering, not removing a single stale entry, so a hard validation
  // error here would leave an admin with no way to ever save settings
  // again once a zone is deleted-and-recreated with a new id. See
  // reconcileZonePriorityOrder's own comment.
  it("silently dedupes a duplicate zone id in zone_priority_order, warning rather than rejecting", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1", name: "Zone 1" }]);
    const result = await updateSettingsForInstallation("inst-1", {
      zone_priority_order: ["z1", "z1"],
    });
    expect(result.config.zone_priority_order).toEqual(["z1"]);
    expect(result.warnings.some((w) => w.includes("auto-reconciled"))).toBe(
      true,
    );
    expect(updateSystemSettings).toHaveBeenCalledOnce();
  });

  it("drops an unknown zone id from zone_priority_order, warning rather than rejecting", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1", name: "Zone 1" }]);
    const result = await updateSettingsForInstallation("inst-1", {
      zone_priority_order: ["unknown-zone"],
    });
    expect(result.config.zone_priority_order).toEqual(["z1"]);
    expect(result.warnings.some((w) => w.includes("auto-reconciled"))).toBe(
      true,
    );
  });

  it("accepts a valid zone_priority_order without adding its own warning", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1" }, { id: "z2" }]);
    const result = await updateSettingsForInstallation("inst-1", {
      zone_priority_order: ["z1", "z2"],
    });
    // The default min_step_delta/modulation_step relationship already
    // warns regardless (see the test above) — this asserts the
    // priority-order check itself contributes nothing extra, not that
    // the whole warnings array is empty.
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("priority")),
    ).toBe(false);
    expect(updateSystemSettings).toHaveBeenCalledOnce();
  });

  describe("reseeding startup reconciliation on a shadow→live promotion", () => {
    it("clears the startup-reconciliation flag when an air handler is newly promoted", async () => {
      getSystemSettings.mockResolvedValue(
        resolveSystemSettings({ live_air_handler_ids: [] }),
      );
      await updateSettingsForInstallation("inst-1", {
        live_air_handler_ids: ["11111111-1111-4111-8111-111111111111"],
      });
      expect(redisDel).toHaveBeenCalledWith("recon:startupSeeded:inst-1");
    });

    it("does not touch the flag when live_air_handler_ids is unchanged", async () => {
      getSystemSettings.mockResolvedValue(
        resolveSystemSettings({
          live_air_handler_ids: ["11111111-1111-4111-8111-111111111111"],
        }),
      );
      await updateSettingsForInstallation("inst-1", {
        live_air_handler_ids: ["11111111-1111-4111-8111-111111111111"],
      });
      expect(redisDel).not.toHaveBeenCalled();
    });

    it("does not touch the flag when a handler is only demoted, not promoted", async () => {
      getSystemSettings.mockResolvedValue(
        resolveSystemSettings({
          live_air_handler_ids: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        }),
      );
      await updateSettingsForInstallation("inst-1", {
        live_air_handler_ids: ["11111111-1111-4111-8111-111111111111"],
      });
      expect(redisDel).not.toHaveBeenCalled();
    });

    it("does not touch the flag when the patch never mentions live_air_handler_ids", async () => {
      await updateSettingsForInstallation("inst-1", {
        home_timezone: "America/Denver",
      });
      expect(redisDel).not.toHaveBeenCalled();
    });
  });
});
