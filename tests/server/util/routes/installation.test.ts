import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, insert, update } = vi.hoisted(() => ({
  find: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getOrCreateDefaultInstallation, setInstallationFlairStructureId } =
  await import("~/server/util/routes/installation");

describe("getOrCreateDefaultInstallation", () => {
  beforeEach(() => {
    find.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
  });

  it("returns the existing installation without inserting a new one", async () => {
    find.mockResolvedValue([
      { id: "inst-1", name: "Existing", flair_structure_id: "92514" },
    ]);
    const result = await getOrCreateDefaultInstallation();
    expect(result).toEqual({
      id: "inst-1",
      name: "Existing",
      flairStructureId: "92514",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the single row when none exists yet, using the given name", async () => {
    find.mockResolvedValue([]);
    const result = await getOrCreateDefaultInstallation("My House");
    expect(result.name).toBe("My House");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My House", id: result.id }),
    );
  });

  it("defaults the name to 'Default Installation' when not given", async () => {
    find.mockResolvedValue([]);
    const result = await getOrCreateDefaultInstallation();
    expect(result.name).toBe("Default Installation");
  });

  it("leaves flairStructureId null for a newly created installation", async () => {
    find.mockResolvedValue([]);
    const result = await getOrCreateDefaultInstallation();
    expect(result.flairStructureId).toBeNull();
  });
});

describe("setInstallationFlairStructureId", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue(undefined);
  });

  it("updates the installation's flair_structure_id", async () => {
    await setInstallationFlairStructureId("inst-1", "92514");
    expect(update).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ flair_structure_id: "92514" }),
    );
  });
});
