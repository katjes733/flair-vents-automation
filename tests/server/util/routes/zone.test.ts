import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, update } = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getZonesForAirHandler, updateZoneState } =
  await import("~/server/util/routes/zone");

describe("getZonesForAirHandler", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("fills in default runtime state fields not yet present on an older row", async () => {
    find.mockResolvedValue([
      {
        id: "z1",
        installation_id: "inst-1",
        air_handler_id: "ah-1",
        flair_room_id: "room-1",
        name: "Bedroom",
        vent_hardware_type: "flair_smart_vent",
        config: {},
        state: { last_target_position: 42 },
      },
    ]);
    const [zone] = await getZonesForAirHandler("ah-1");
    expect(zone.state.last_target_position).toBe(42);
    expect(zone.state.degraded).toBe(false); // default filled in
  });
});

describe("updateZoneState", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue(undefined);
  });

  it("writes the given state and bumps modified_time", async () => {
    await updateZoneState("z1", {
      last_target_position: 50,
      last_commanded_at: null,
      last_reported_position: null,
      degraded: false,
      degraded_since: null,
      reconcile_attempts: 0,
      last_reading_value: null,
      last_reading_changed_at: null,
      stale: false,
      spike_active: false,
      spike_since: null,
      last_classification: null,
      occupied: false,
      occupancy_pending_flip_since: null,
    });
    expect(update).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        state: expect.objectContaining({ last_target_position: 50 }),
        modified_time: expect.any(Date),
      }),
    );
  });
});
