import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, findOne, insert, update, deleteFn } = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  deleteFn: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({
    find,
    findOne,
    insert,
    update,
    delete: deleteFn,
  })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const {
  getSchedulesForInstallation,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} = await import("~/server/util/routes/schedule");

describe("getSchedulesForInstallation", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("resolves events/config with their schema defaults", async () => {
    find.mockResolvedValue([
      {
        id: "s1",
        installation_id: "inst-1",
        name: "Night",
        events: [],
        config: {},
      },
    ]);
    const [schedule] = await getSchedulesForInstallation("inst-1");
    expect(schedule.events).toEqual([]);
    expect(schedule.config.enabled).toBe(true);
    expect(schedule.config.default_inactive).toBe(false);
  });
});

describe("getScheduleById", () => {
  it("returns null when not found", async () => {
    findOne.mockReset().mockResolvedValue(null);
    expect(await getScheduleById("missing")).toBe(null);
  });
});

describe("createSchedule", () => {
  it("inserts a new row with fresh timestamps", async () => {
    insert.mockReset().mockResolvedValue(undefined);
    const schedule = await createSchedule({
      installationId: "inst-1",
      name: "Night",
      events: [],
      config: { enabled: true, default_inactive: false },
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(schedule.name).toBe("Night");
  });
});

describe("updateSchedule", () => {
  it("only writes fields that were actually passed", async () => {
    update.mockReset().mockResolvedValue(undefined);
    await updateSchedule("s1", { name: "New name" });
    expect(update).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        name: "New name",
        modified_time: expect.any(Date),
      }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty("events");
  });
});

describe("deleteSchedule", () => {
  it("deletes by id", async () => {
    deleteFn.mockReset().mockResolvedValue(undefined);
    await deleteSchedule("s1");
    expect(deleteFn).toHaveBeenCalledWith("s1");
  });
});
