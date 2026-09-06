import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, findOneBy, insert, update } = vi.hoisted(() => ({
  find: vi.fn(),
  findOneBy: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find, findOneBy, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const {
  getOrCreateDefaultInstallation,
  getActiveInstallations,
  getInstallationById,
  setInstallationFlairStructureId,
} = await import("~/server/util/routes/installation");

describe("getOrCreateDefaultInstallation", () => {
  beforeEach(() => {
    find.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
  });

  it("returns the existing installation without inserting a new one", async () => {
    find.mockResolvedValue([
      {
        id: "inst-1",
        name: "Existing",
        flair_structure_id: "92514",
        is_active: true,
      },
    ]);
    const result = await getOrCreateDefaultInstallation();
    expect(result).toEqual({
      id: "inst-1",
      name: "Existing",
      flairStructureId: "92514",
      isActive: true,
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

  it("marks a newly created installation active", async () => {
    find.mockResolvedValue([]);
    const result = await getOrCreateDefaultInstallation();
    expect(result.isActive).toBe(true);
  });
});

describe("getActiveInstallations", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("filters out an installation with no linked Flair structure", async () => {
    find.mockResolvedValue([
      {
        id: "inst-1",
        name: "Default Installation",
        flair_structure_id: null,
        is_active: true,
      },
      {
        id: "inst-2",
        name: "Real Home",
        flair_structure_id: "92514",
        is_active: true,
      },
    ]);
    expect(await getActiveInstallations()).toEqual([
      {
        id: "inst-2",
        name: "Real Home",
        flairStructureId: "92514",
        isActive: true,
      },
    ]);
  });

  it("filters out a deactivated installation even if it has a linked Flair structure", async () => {
    find.mockResolvedValue([
      {
        id: "inst-1",
        name: "Paused Home",
        flair_structure_id: "92514",
        is_active: false,
      },
    ]);
    expect(await getActiveInstallations()).toEqual([]);
  });

  it("returns an empty array when nothing is linked yet", async () => {
    find.mockResolvedValue([
      {
        id: "inst-1",
        name: "Default Installation",
        flair_structure_id: null,
        is_active: true,
      },
    ]);
    expect(await getActiveInstallations()).toEqual([]);
  });

  it("returns every linked, active installation when there's more than one", async () => {
    find.mockResolvedValue([
      {
        id: "inst-1",
        name: "Home A",
        flair_structure_id: "1",
        is_active: true,
      },
      {
        id: "inst-2",
        name: "Home B",
        flair_structure_id: "2",
        is_active: true,
      },
    ]);
    expect(await getActiveInstallations()).toEqual([
      { id: "inst-1", name: "Home A", flairStructureId: "1", isActive: true },
      { id: "inst-2", name: "Home B", flairStructureId: "2", isActive: true },
    ]);
  });
});

describe("getInstallationById", () => {
  beforeEach(() => {
    findOneBy.mockReset();
  });

  it("returns null when no installation exists for that id", async () => {
    findOneBy.mockResolvedValue(null);
    expect(await getInstallationById("missing")).toBeNull();
  });

  it("maps a found row", async () => {
    findOneBy.mockResolvedValue({
      id: "inst-1",
      name: "Home",
      flair_structure_id: "92514",
      is_active: true,
    });
    expect(await getInstallationById("inst-1")).toEqual({
      id: "inst-1",
      name: "Home",
      flairStructureId: "92514",
      isActive: true,
    });
    expect(findOneBy).toHaveBeenCalledWith({ id: "inst-1" });
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
