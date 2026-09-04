import { describe, it, expect, vi, beforeEach } from "vitest";

const { getZoneById } = vi.hoisted(() => ({ getZoneById: vi.fn() }));
vi.mock("~/server/util/routes/zone", () => ({ getZoneById }));

const { getSchedulesForInstallation } = vi.hoisted(() => ({
  getSchedulesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/schedule", () => ({
  getSchedulesForInstallation,
}));

const { getSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({ getSystemSettings }));

const {
  createManualOverride,
  revokeManualOverride,
  getOverridesForZoneInRange,
} = vi.hoisted(() => ({
  createManualOverride: vi.fn(),
  revokeManualOverride: vi.fn(),
  getOverridesForZoneInRange: vi.fn(),
}));
vi.mock("~/server/util/routes/manualOverride", () => ({
  createManualOverride,
  revokeManualOverride,
  getOverridesForZoneInRange,
  getLatestOverridesForZones: vi.fn(),
}));

const { createOverrideForZone, revokeOverride, getOverrideHistoryForZone } =
  await import("~/server/util/services/overrideService");

describe("createOverrideForZone", () => {
  beforeEach(() => {
    getZoneById.mockReset();
    createManualOverride.mockReset().mockResolvedValue({ id: "mo-1" });
  });

  it("404s when the zone doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    await expect(
      createOverrideForZone({
        kind: "position",
        zone_id: "missing",
        value: 50,
        hold_type: "2h",
        actor: "Martin",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("computes a fixed expiry for a 2h hold", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    await createOverrideForZone({
      kind: "position",
      zone_id: "z1",
      value: 50,
      hold_type: "2h",
      actor: "Martin",
    });
    const call = createManualOverride.mock.calls[0][0];
    expect(call.expiresAtMs).toBeGreaterThan(Date.now());
    expect(call.expiresAtMs).toBeLessThanOrEqual(
      Date.now() + 2 * 60 * 60 * 1000,
    );
  });

  it("resolves null expiry for a permanent hold", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    await createOverrideForZone({
      kind: "setpoint",
      zone_id: "z1",
      value: 21,
      hold_type: "permanent",
      actor: "Martin",
    });
    expect(createManualOverride.mock.calls[0][0].expiresAtMs).toBe(null);
  });

  it("scans the zone's own schedule events for 'until next event'", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    getSystemSettings.mockResolvedValue({ home_timezone: "UTC" });
    getSchedulesForInstallation.mockResolvedValue([
      {
        events: [
          {
            zone_settings: [{ zone_id: "z1" }],
            start_time: "20:00",
            end_time: "07:00",
            days_of_week: 0b1111111,
          },
        ],
      },
    ]);
    await createOverrideForZone({
      kind: "position",
      zone_id: "z1",
      value: 50,
      hold_type: "until_next_event",
      actor: "Martin",
    });
    // Just confirming the scan path ran without throwing and produced
    // *some* resolved value (null or a real timestamp) — the scan logic
    // itself is unit-tested directly in manualOverride.test.ts.
    expect(createManualOverride).toHaveBeenCalledOnce();
  });
});

describe("revokeOverride", () => {
  it("delegates to revokeManualOverride", async () => {
    revokeManualOverride.mockReset().mockResolvedValue(undefined);
    await revokeOverride("mo-1");
    expect(revokeManualOverride).toHaveBeenCalledWith("mo-1");
  });
});

describe("getOverrideHistoryForZone", () => {
  beforeEach(() => {
    getZoneById.mockReset();
    getOverridesForZoneInRange.mockReset();
  });

  it("404s when the zone doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    await expect(getOverrideHistoryForZone("missing", 0, 1000)).rejects.toThrow(
      /not found/,
    );
    expect(getOverridesForZoneInRange).not.toHaveBeenCalled();
  });

  it("delegates to getOverridesForZoneInRange for a real zone", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    getOverridesForZoneInRange.mockResolvedValue([{ id: "mo-1" }]);
    const result = await getOverrideHistoryForZone("z1", 0, 1000);
    expect(result).toEqual([{ id: "mo-1" }]);
    expect(getOverridesForZoneInRange).toHaveBeenCalledWith("z1", 0, 1000);
  });
});
