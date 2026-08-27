import { describe, it, expect, vi, beforeEach } from "vitest";

const { incr, expire, get } = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  get: vi.fn(),
}));

vi.mock("~/server/util/redis", () => ({
  redis: { incr, expire, get },
}));

const { recordTokenCall, getTokenCallsToday, FLAIR_TOKEN_DAILY_BUDGET } =
  await import("~/server/util/flair/tokenBudget");

describe("token budget", () => {
  beforeEach(() => {
    incr.mockReset();
    expire.mockReset();
    get.mockReset();
  });

  it("exposes the ~50/day working-assumption budget", () => {
    expect(FLAIR_TOKEN_DAILY_BUDGET).toBe(50);
  });

  it("sets a 24h TTL only on the first call of a window", async () => {
    incr.mockResolvedValue(1);
    await recordTokenCall();
    expect(expire).toHaveBeenCalledWith("flair:tokenCallsToday", 24 * 60 * 60);
  });

  it("does not re-set the TTL on subsequent calls within the window", async () => {
    incr.mockResolvedValue(2);
    await recordTokenCall();
    expect(expire).not.toHaveBeenCalled();
  });

  it("returns the incremented count", async () => {
    incr.mockResolvedValue(7);
    expect(await recordTokenCall()).toBe(7);
  });

  it("reports 0 calls today when the key doesn't exist yet", async () => {
    get.mockResolvedValue(null);
    expect(await getTokenCallsToday()).toBe(0);
  });

  it("reports the stored count as a number", async () => {
    get.mockResolvedValue("12");
    expect(await getTokenCallsToday()).toBe(12);
  });
});
