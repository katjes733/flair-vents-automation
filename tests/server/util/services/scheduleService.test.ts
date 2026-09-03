import { describe, it, expect, vi, beforeEach } from "vitest";

const { getZonesForInstallation } = vi.hoisted(() => ({
  getZonesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForInstallation }));

const { createSchedule, updateSchedule, deleteSchedule, getScheduleById } =
  vi.hoisted(() => ({
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    getScheduleById: vi.fn(),
  }));
vi.mock("~/server/util/routes/schedule", () => ({
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getScheduleById,
}));

const {
  createScheduleForInstallation,
  updateScheduleWithValidation,
  deleteScheduleWithValidation,
} = await import("~/server/util/services/scheduleService");

const ZONES = [{ id: "z1" }, { id: "z2" }];

describe("createScheduleForInstallation", () => {
  beforeEach(() => {
    getZonesForInstallation.mockReset().mockResolvedValue(ZONES);
    createSchedule.mockReset().mockResolvedValue({ id: "s1" });
  });

  it("rejects an active event missing cool/heat setpoints for an assigned zone", async () => {
    await expect(
      createScheduleForInstallation({
        installationId: "inst-1",
        name: "Night",
        events: [
          {
            mode: "active",
            start_time: "20:00",
            end_time: "07:00",
            days_of_week: 0b1111111,
            zone_settings: [{ zone_id: "z1", assume_occupied: false }],
          },
        ],
        config: { enabled: true, default_inactive: false },
      }),
    ).rejects.toThrow(/cool_setpoint\/heat_setpoint/);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("rejects a zone_settings row referencing an unknown zone", async () => {
    await expect(
      createScheduleForInstallation({
        installationId: "inst-1",
        name: "Night",
        events: [
          {
            mode: "inactive",
            start_time: "20:00",
            end_time: "07:00",
            days_of_week: 0b1111111,
            zone_settings: [
              { zone_id: "unknown-zone", assume_occupied: false },
            ],
          },
        ],
        config: { enabled: true, default_inactive: false },
      }),
    ).rejects.toThrow(/unknown or cross-installation/);
  });

  it("assigns a fresh id/created_at/modified_at to a brand-new event", async () => {
    await createScheduleForInstallation({
      installationId: "inst-1",
      name: "Night",
      events: [
        {
          mode: "inactive",
          start_time: "20:00",
          end_time: "07:00",
          days_of_week: 0b1111111,
          zone_settings: [],
        },
      ],
      config: { enabled: true, default_inactive: false },
    });
    const savedEvents = createSchedule.mock.calls[0][0].events;
    expect(savedEvents[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(savedEvents[0].created_at).toBe(savedEvents[0].modified_at);
  });
});

describe("updateScheduleWithValidation", () => {
  beforeEach(() => {
    getZonesForInstallation.mockReset().mockResolvedValue(ZONES);
    getScheduleById.mockReset();
    updateSchedule.mockReset().mockResolvedValue(undefined);
  });

  it("404s when the schedule doesn't exist", async () => {
    getScheduleById.mockResolvedValue(null);
    await expect(
      updateScheduleWithValidation("missing", { name: "New" }),
    ).rejects.toThrow(/not found/);
  });

  it("preserves an existing event's created_at while bumping modified_at", async () => {
    getScheduleById
      .mockResolvedValueOnce({
        id: "s1",
        installationId: "inst-1",
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "inactive",
            start_time: "20:00",
            end_time: "07:00",
            days_of_week: 0b1111111,
            zone_settings: [],
          },
        ],
        config: { enabled: true, default_inactive: false },
      })
      .mockResolvedValueOnce({ id: "s1", name: "Updated" });

    await updateScheduleWithValidation("s1", {
      events: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          mode: "inactive",
          start_time: "21:00",
          end_time: "07:00",
          days_of_week: 0b1111111,
          zone_settings: [],
        },
      ],
    });

    const savedEvents = updateSchedule.mock.calls[0][1].events;
    expect(savedEvents[0].created_at).toBe("2024-01-01T00:00:00.000Z");
    expect(savedEvents[0].modified_at).not.toBe("2024-01-01T00:00:00.000Z");
    expect(savedEvents[0].start_time).toBe("21:00");
  });
});

describe("deleteScheduleWithValidation", () => {
  it("404s when the schedule doesn't exist", async () => {
    getScheduleById.mockReset().mockResolvedValue(null);
    await expect(deleteScheduleWithValidation("missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("deletes cleanly when it exists", async () => {
    getScheduleById.mockReset().mockResolvedValue({ id: "s1" });
    deleteSchedule.mockReset().mockResolvedValue(undefined);
    await deleteScheduleWithValidation("s1");
    expect(deleteSchedule).toHaveBeenCalledWith("s1");
  });
});
