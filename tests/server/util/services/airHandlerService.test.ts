import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createAirHandler,
  updateAirHandler,
  deleteAirHandler,
  getAirHandlerById,
  getAirHandlersForInstallation,
} = vi.hoisted(() => ({
  createAirHandler: vi.fn(),
  updateAirHandler: vi.fn(),
  deleteAirHandler: vi.fn(),
  getAirHandlerById: vi.fn(),
  getAirHandlersForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({
  createAirHandler,
  updateAirHandler,
  deleteAirHandler,
  getAirHandlerById,
  getAirHandlersForInstallation,
}));

const { getZonesForAirHandler } = vi.hoisted(() => ({
  getZonesForAirHandler: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForAirHandler }));

const {
  createAirHandlerForInstallation,
  updateAirHandlerWithValidation,
  deleteAirHandlerWithValidation,
} = await import("~/server/util/services/airHandlerService");

const BASE_CONFIG = {
  topology_mode: "variable_speed" as const,
  blower_rated_flow_rate_is_estimate: true,
  minimum_aggregate_flow_is_estimate: true,
};

describe("createAirHandlerForInstallation", () => {
  beforeEach(() => {
    createAirHandler.mockReset().mockResolvedValue({ id: "ah-1" });
    getAirHandlersForInstallation.mockReset().mockResolvedValue([]);
  });

  it("rejects a Flair zone id already assigned to another air handler", async () => {
    getAirHandlersForInstallation.mockResolvedValue([
      { id: "ah-other", name: "Downstairs", flairZoneId: "fz-1" },
    ]);
    await expect(
      createAirHandlerForInstallation({
        installationId: "inst-1",
        flairZoneId: "fz-1",
        name: "Upstairs",
        active: false,
        config: BASE_CONFIG,
      }),
    ).rejects.toThrow(/already assigned to air handler "Downstairs"/);
    expect(createAirHandler).not.toHaveBeenCalled();
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
    getAirHandlersForInstallation.mockReset().mockResolvedValue([]);
  });

  it("rejects a Flair zone id already assigned to a different air handler", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
      active: true,
      config: { ...BASE_CONFIG, tonnage_tons: 5 },
    });
    getAirHandlersForInstallation.mockResolvedValue([
      { id: "ah-other", name: "Downstairs", flairZoneId: "fz-1" },
    ]);
    await expect(
      updateAirHandlerWithValidation("ah-1", { flairZoneId: "fz-1" }),
    ).rejects.toThrow(/already assigned to air handler "Downstairs"/);
    expect(updateAirHandler).not.toHaveBeenCalled();
  });

  it("allows re-saving an air handler's own already-assigned Flair zone id", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
      active: true,
      config: { ...BASE_CONFIG, tonnage_tons: 5 },
    });
    getAirHandlersForInstallation.mockResolvedValue([
      { id: "ah-1", name: "Upstairs", flairZoneId: "fz-1" },
    ]);
    await updateAirHandlerWithValidation("ah-1", { flairZoneId: "fz-1" });
    expect(updateAirHandler).toHaveBeenCalledWith(
      "ah-1",
      expect.objectContaining({ flairZoneId: "fz-1" }),
    );
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

describe("deleteAirHandlerWithValidation", () => {
  beforeEach(() => {
    getAirHandlerById.mockReset();
    getZonesForAirHandler.mockReset();
    deleteAirHandler.mockReset().mockResolvedValue(undefined);
  });

  it("404s when the air handler doesn't exist", async () => {
    getAirHandlerById.mockResolvedValue(null);
    await expect(deleteAirHandlerWithValidation("missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("refuses to delete an air handler that still has zones", async () => {
    getAirHandlerById.mockResolvedValue({ id: "ah-1", name: "Upstairs" });
    getZonesForAirHandler.mockResolvedValue([{ name: "Bedroom" }]);
    await expect(deleteAirHandlerWithValidation("ah-1")).rejects.toThrow(
      /Bedroom/,
    );
    expect(deleteAirHandler).not.toHaveBeenCalled();
  });

  it("deletes cleanly when no zone belongs to it", async () => {
    getAirHandlerById.mockResolvedValue({ id: "ah-1", name: "Upstairs" });
    getZonesForAirHandler.mockResolvedValue([]);
    await deleteAirHandlerWithValidation("ah-1");
    expect(deleteAirHandler).toHaveBeenCalledWith("ah-1");
  });
});
