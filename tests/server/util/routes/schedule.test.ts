import { describe, it, expect, vi, beforeEach } from "vitest";

const { find } = vi.hoisted(() => ({ find: vi.fn() }));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getSchedulesForInstallation } =
  await import("~/server/util/routes/schedule");

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
