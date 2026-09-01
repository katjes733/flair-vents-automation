import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOne } = vi.hoisted(() => ({ findOne: vi.fn() }));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOne })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getSystemSettings } =
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
