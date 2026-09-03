import { describe, it, expect, vi } from "vitest";
import { retry } from "~/server/util/retry";

describe("retry", () => {
  it("returns the result on the first successful attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure and returns the eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const result = await retry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error once retries are exhausted", async () => {
    const err = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retry(fn, 2, 0)).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("backs off with the configured factor between attempts", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const promise = retry(fn, 3, 100, 2);

    // First attempt fails immediately, then waits 100ms before the second.
    await vi.advanceTimersByTimeAsync(100);
    // Second attempt fails, then waits 200ms (100 * backoffFactor) before the third.
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
