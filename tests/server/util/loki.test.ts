import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLokiConfigured, fetchTickDecisionHistory } from "~/server/util/loki";

const originalLokiUrl = process.env.LOKI_URL;

afterEach(() => {
  process.env.LOKI_URL = originalLokiUrl;
  vi.unstubAllGlobals();
});

describe("isLokiConfigured", () => {
  it("is false when LOKI_URL is unset", () => {
    delete process.env.LOKI_URL;
    expect(isLokiConfigured()).toBe(false);
  });

  it("is true when LOKI_URL is set", () => {
    process.env.LOKI_URL = "http://loki:3100";
    expect(isLokiConfigured()).toBe(true);
  });
});

describe("fetchTickDecisionHistory", () => {
  beforeEach(() => {
    process.env.LOKI_URL = "http://loki:3100";
  });

  it("throws when Loki isn't configured", async () => {
    delete process.env.LOKI_URL;
    await expect(
      fetchTickDecisionHistory("ah-1", 0, 1000, 100),
    ).rejects.toThrow(/LOKI_URL/);
  });

  it("parses decisions out of raw log lines and sorts them by time", async () => {
    const decisionEarly = { air_handler_id: "ah-1", tick_at: "early" };
    const decisionLate = { air_handler_id: "ah-1", tick_at: "late" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          data: {
            resultType: "streams",
            result: [
              {
                stream: { service: "control", air_handler_id: "ah-1" },
                // Deliberately out of order — the function must sort, not
                // trust the order Loki happens to return.
                values: [
                  [
                    "2000000000",
                    JSON.stringify({
                      msg: "Control tick decision",
                      decision: decisionLate,
                    }),
                  ],
                  [
                    "1000000000",
                    JSON.stringify({
                      msg: "Control tick decision",
                      decision: decisionEarly,
                    }),
                  ],
                ],
              },
            ],
          },
        }),
      }),
    );

    const points = await fetchTickDecisionHistory("ah-1", 0, 5000, 100);
    expect(points).toEqual([
      { loggedAtMs: 1000, decision: decisionEarly },
      { loggedAtMs: 2000, decision: decisionLate },
    ]);
  });

  it("skips a log line that isn't valid JSON instead of throwing", async () => {
    const decision = { air_handler_id: "ah-1", tick_at: "ok" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          data: {
            resultType: "streams",
            result: [
              {
                stream: {},
                values: [
                  ["1000000000", "not json"],
                  ["2000000000", JSON.stringify({ decision })],
                ],
              },
            ],
          },
        }),
      }),
    );

    const points = await fetchTickDecisionHistory("ah-1", 0, 5000, 100);
    expect(points).toEqual([{ loggedAtMs: 2000, decision }]);
  });

  it("throws a clear error when the Loki HTTP call itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    await expect(
      fetchTickDecisionHistory("ah-1", 0, 1000, 100),
    ).rejects.toThrow(/Loki query failed/);
  });

  it("builds the query with the air handler id and passes the range/limit through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: { resultType: "streams", result: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchTickDecisionHistory("ah-1", 1000, 2000, 42);

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/loki/api/v1/query_range");
    expect(calledUrl.searchParams.get("query")).toContain(
      'air_handler_id="ah-1"',
    );
    expect(calledUrl.searchParams.get("query")).toContain(
      "Control tick decision",
    );
    expect(calledUrl.searchParams.get("start")).toBe("1000000000");
    expect(calledUrl.searchParams.get("end")).toBe("2000000000");
    expect(calledUrl.searchParams.get("limit")).toBe("42");
    // Regression test for a real, confirmed bug found live: this used to be
    // "forward", which fills a truncated (window-larger-than-limit) result
    // from the *oldest* end — every chart on the Telemetry page silently
    // plotted a stale slice ending hours before "now", which looked exactly
    // like a timezone bug (a correctly-local-formatted but very-old
    // timestamp) rather than the pagination bug it actually was. Every
    // current caller wants the newest points in the window, not the oldest.
    expect(calledUrl.searchParams.get("direction")).toBe("backward");
  });

  it("still returns points in chronological order even though Loki itself is queried backward", async () => {
    // Mirrors the out-of-order test above, but is the direct regression
    // guard for the "backward" fix specifically: Loki's own backward-
    // direction response order is newest-first, so if the final sort ever
    // regressed, this would come back reversed instead of chronological.
    const decisionEarly = { air_handler_id: "ah-1", tick_at: "early" };
    const decisionLate = { air_handler_id: "ah-1", tick_at: "late" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          data: {
            resultType: "streams",
            result: [
              {
                stream: { service: "control", air_handler_id: "ah-1" },
                // Loki's own newest-first order under direction=backward.
                values: [
                  [
                    "2000000000",
                    JSON.stringify({
                      msg: "Control tick decision",
                      decision: decisionLate,
                    }),
                  ],
                  [
                    "1000000000",
                    JSON.stringify({
                      msg: "Control tick decision",
                      decision: decisionEarly,
                    }),
                  ],
                ],
              },
            ],
          },
        }),
      }),
    );

    const points = await fetchTickDecisionHistory("ah-1", 0, 5000, 100);
    expect(points).toEqual([
      { loggedAtMs: 1000, decision: decisionEarly },
      { loggedAtMs: 2000, decision: decisionLate },
    ]);
  });
});
