import { describe, it, expect, vi, beforeEach } from "vitest";

const { setInstallationFlairStructureId } = vi.hoisted(() => ({
  setInstallationFlairStructureId: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  setInstallationFlairStructureId,
}));

const { ensureFlairStructureLinked } =
  await import("~/server/util/services/installationService");

function fakeFlairClient(fetchStructures: () => Promise<unknown>) {
  return { fetchStructures } as never;
}

describe("ensureFlairStructureLinked", () => {
  beforeEach(() => {
    setInstallationFlairStructureId.mockReset().mockResolvedValue(undefined);
  });

  it("returns the installation unchanged when already linked, without calling Flair", async () => {
    const fetchStructures = vi.fn();
    const installation = {
      id: "inst-1",
      name: "Home",
      flairStructureId: "92514",
    };
    const result = await ensureFlairStructureLinked(
      installation,
      fakeFlairClient(fetchStructures),
    );
    expect(result).toEqual(installation);
    expect(fetchStructures).not.toHaveBeenCalled();
    expect(setInstallationFlairStructureId).not.toHaveBeenCalled();
  });

  it("auto-links when unset and exactly one Flair structure exists", async () => {
    const fetchStructures = vi
      .fn()
      .mockResolvedValue([{ id: "92514", name: "Home", timeZone: null }]);
    const installation = { id: "inst-1", name: "Home", flairStructureId: null };
    const result = await ensureFlairStructureLinked(
      installation,
      fakeFlairClient(fetchStructures),
    );
    expect(result.flairStructureId).toBe("92514");
    expect(setInstallationFlairStructureId).toHaveBeenCalledWith(
      "inst-1",
      "92514",
    );
  });

  it("rejects when the account has no Flair structures", async () => {
    const fetchStructures = vi.fn().mockResolvedValue([]);
    await expect(
      ensureFlairStructureLinked(
        { id: "inst-1", name: "Home", flairStructureId: null },
        fakeFlairClient(fetchStructures),
      ),
    ).rejects.toThrow(/No Flair structures found/);
    expect(setInstallationFlairStructureId).not.toHaveBeenCalled();
  });

  it("rejects rather than guessing when the account has more than one structure", async () => {
    const fetchStructures = vi.fn().mockResolvedValue([
      { id: "1", name: "Home", timeZone: null },
      { id: "2", name: "Cabin", timeZone: null },
    ]);
    await expect(
      ensureFlairStructureLinked(
        { id: "inst-1", name: "Home", flairStructureId: null },
        fakeFlairClient(fetchStructures),
      ),
    ).rejects.toThrow(/Multiple Flair structures/);
    expect(setInstallationFlairStructureId).not.toHaveBeenCalled();
  });
});
