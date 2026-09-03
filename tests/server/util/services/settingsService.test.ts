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

const { updateSettingsForInstallation } =
  await import("~/server/util/services/settingsService");

describe("updateSettingsForInstallation", () => {
  beforeEach(() => {
    getSystemSettings.mockReset().mockResolvedValue(resolveSystemSettings({}));
    updateSystemSettings.mockReset().mockResolvedValue(undefined);
    getZonesForInstallation.mockReset().mockResolvedValue([]);
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

  it("rejects a duplicate zone id in zone_priority_order outright", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1" }]);
    await expect(
      updateSettingsForInstallation("inst-1", {
        zone_priority_order: ["z1", "z1"],
      }),
    ).rejects.toThrow(/appears more than once/);
    expect(updateSystemSettings).not.toHaveBeenCalled();
  });

  it("rejects an unknown zone id in zone_priority_order", async () => {
    getZonesForInstallation.mockResolvedValue([{ id: "z1" }]);
    await expect(
      updateSettingsForInstallation("inst-1", {
        zone_priority_order: ["unknown-zone"],
      }),
    ).rejects.toThrow(/does not exist/);
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
});
