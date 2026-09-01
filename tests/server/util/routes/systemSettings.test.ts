import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOne, insert, update } = vi.hoisted(() => ({
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOne, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getSystemSettings, updateSystemSettings } =
  await import("~/server/util/routes/systemSettings");

describe("getSystemSettings", () => {
  beforeEach(() => {
    findOne.mockReset();
  });

  it("resolves defaults when no row exists yet", async () => {
    findOne.mockResolvedValue(null);
    const settings = await getSystemSettings("inst-1");
    expect(settings.control_tick_interval_seconds).toBe(60);
  });

  it("resolves the stored config when a row exists", async () => {
    findOne.mockResolvedValue({ config: { home_timezone: "America/Denver" } });
    const settings = await getSystemSettings("inst-1");
    expect(settings.home_timezone).toBe("America/Denver");
  });
});

describe("updateSystemSettings", () => {
  beforeEach(() => {
    findOne.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
    update.mockReset().mockResolvedValue(undefined);
  });

  it("inserts a new row when none exists yet — no seed step creates one", async () => {
    findOne.mockResolvedValue(null);
    const config = { ...(await getSystemSettings("inst-1")) };
    await updateSystemSettings("inst-1", config);
    expect(insert).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing row rather than inserting a duplicate", async () => {
    findOne.mockResolvedValue({ id: "row-1", config: {} });
    const config = { ...(await getSystemSettings("inst-1")) };
    await updateSystemSettings("inst-1", config);
    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ config, modified_time: expect.any(Date) }),
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
