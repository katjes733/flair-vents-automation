import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAirHandler, updateAirHandler, getAirHandlerById } = vi.hoisted(
  () => ({
    createAirHandler: vi.fn(),
    updateAirHandler: vi.fn(),
    getAirHandlerById: vi.fn(),
  }),
);
vi.mock("~/server/util/routes/airHandler", () => ({
  createAirHandler,
  updateAirHandler,
  getAirHandlerById,
}));

const { createAirHandlerForInstallation, updateAirHandlerWithValidation } =
  await import("~/server/util/services/airHandlerService");

const BASE_CONFIG = {
  topology_mode: "variable_speed" as const,
  blower_rated_flow_rate_is_estimate: true,
  minimum_aggregate_flow_is_estimate: true,
};

describe("createAirHandlerForInstallation", () => {
  beforeEach(() => {
    createAirHandler.mockReset().mockResolvedValue({ id: "ah-1" });
  });

  it("rejects setting active without tonnage_tons", async () => {
    await expect(
      createAirHandlerForInstallation({
        installationId: "inst-1",
        flairZoneId: null,
        name: "Upstairs",
        active: true,
        config: BASE_CONFIG,
      }),
    ).rejects.toThrow(/tonnage_tons is required/);
    expect(createAirHandler).not.toHaveBeenCalled();
  });

  it("allows an inactive handler with no tonnage yet", async () => {
    const result = await createAirHandlerForInstallation({
      installationId: "inst-1",
      flairZoneId: null,
      name: "Upstairs",
      active: false,
      config: BASE_CONFIG,
    });
    expect(createAirHandler).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "ah-1" });
  });
});

describe("updateAirHandlerWithValidation", () => {
  beforeEach(() => {
    getAirHandlerById.mockReset();
    updateAirHandler.mockReset().mockResolvedValue(undefined);
  });

  it("404s when the air handler doesn't exist", async () => {
    getAirHandlerById.mockResolvedValue(null);
    await expect(
      updateAirHandlerWithValidation("missing", { name: "New" }),
    ).rejects.toThrow(/not found/);
  });

  it("merges config onto the existing row", async () => {
    getAirHandlerById
      .mockResolvedValueOnce({
        id: "ah-1",
        active: false,
        config: { ...BASE_CONFIG, tonnage_tons: 5 },
      })
      .mockResolvedValueOnce({ id: "ah-1", active: true });
    const result = await updateAirHandlerWithValidation("ah-1", {
      active: true,
    });
    expect(updateAirHandler).toHaveBeenCalledWith(
      "ah-1",
      expect.objectContaining({
        active: true,
        config: expect.objectContaining({ tonnage_tons: 5 }),
      }),
    );
    expect(result).toEqual({ id: "ah-1", active: true });
  });

  it("rejects activating a handler with no tonnage_tons, existing or new", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      active: false,
      config: BASE_CONFIG,
    });
    await expect(
      updateAirHandlerWithValidation("ah-1", { active: true }),
    ).rejects.toThrow(/tonnage_tons is required/);
  });
});
