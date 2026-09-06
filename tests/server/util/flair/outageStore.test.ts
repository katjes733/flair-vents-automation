import { describe, it, expect, vi, beforeEach } from "vitest";

const { get, set, del } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({ redis: { get, set, del } }));

const {
  getOutageState,
  setOutageState,
  getTokenRefreshFailureState,
  setTokenRefreshFailureState,
} = await import("~/server/util/flair/outageStore");

beforeEach(() => {
  get.mockReset();
  set.mockReset().mockResolvedValue(undefined);
  del.mockReset().mockResolvedValue(undefined);
});

describe("getOutageState / setOutageState", () => {
  it("returns the empty (not failing) state when nothing is stored yet", async () => {
    get.mockResolvedValue(null);
    expect(await getOutageState("inst-1")).toEqual({
      failing: false,
      sinceMs: null,
    });
    expect(get).toHaveBeenCalledWith("flair:outage:inst-1");
  });

  it("parses a stored JSON blob", async () => {
    get.mockResolvedValue(JSON.stringify({ failing: true, sinceMs: 1000 }));
    expect(await getOutageState("inst-1")).toEqual({
      failing: true,
      sinceMs: 1000,
    });
  });

  it("writes via SET as a JSON blob, per installation", async () => {
    await setOutageState("inst-1", { failing: true, sinceMs: 5000 });
    expect(set).toHaveBeenCalledWith(
      "flair:outage:inst-1",
      JSON.stringify({ failing: true, sinceMs: 5000 }),
    );
  });

  it("keeps installations independent", async () => {
    get.mockResolvedValue(null);
    await getOutageState("inst-2");
    expect(get).toHaveBeenCalledWith("flair:outage:inst-2");
  });
});

describe("getTokenRefreshFailureState / setTokenRefreshFailureState", () => {
  it("returns null when nothing is stored yet", async () => {
    get.mockResolvedValue(null);
    expect(await getTokenRefreshFailureState("inst-1")).toBeNull();
    expect(get).toHaveBeenCalledWith("flair:tokenRefreshFailure:inst-1");
  });

  it("parses a stored failure state", async () => {
    get.mockResolvedValue(
      JSON.stringify({ terminal: true, message: "invalid_grant" }),
    );
    expect(await getTokenRefreshFailureState("inst-1")).toEqual({
      terminal: true,
      message: "invalid_grant",
    });
  });

  it("writes a non-null state via SET", async () => {
    await setTokenRefreshFailureState("inst-1", {
      terminal: false,
      message: "network error",
    });
    expect(set).toHaveBeenCalledWith(
      "flair:tokenRefreshFailure:inst-1",
      JSON.stringify({ terminal: false, message: "network error" }),
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the key entirely for a null state, rather than storing a tombstone", async () => {
    await setTokenRefreshFailureState("inst-1", null);
    expect(del).toHaveBeenCalledWith("flair:tokenRefreshFailure:inst-1");
    expect(set).not.toHaveBeenCalled();
  });
});
