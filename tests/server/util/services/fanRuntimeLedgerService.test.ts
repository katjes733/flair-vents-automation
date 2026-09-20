import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOne, insert, update } = vi.hoisted(() => ({
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: vi.fn(async () => ({
      getRepository: vi.fn(() => ({ findOne, insert, update })),
    })),
  },
}));

const { recordFanRuntimeInterval } =
  await import("~/server/util/services/fanRuntimeLedgerService");

describe("recordFanRuntimeInterval", () => {
  beforeEach(() => {
    findOne.mockReset().mockResolvedValue(null);
    insert.mockReset().mockResolvedValue(undefined);
    update.mockReset().mockResolvedValue(undefined);
  });

  it("persists runtime split across two wall-clock hours", async () => {
    await recordFanRuntimeInterval({
      airHandlerId: "ah-1",
      timeZone: "UTC",
      interval: {
        startMs: Date.UTC(2026, 0, 1, 12, 55),
        endMs: Date.UTC(2026, 0, 1, 13, 5),
        kind: "heat_cool",
      },
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toMatchObject({
      air_handler_id: "ah-1",
      heat_cool_runtime_seconds: 5 * 60,
      credited_runtime_seconds: 5 * 60,
    });
    expect(insert.mock.calls[1][0]).toMatchObject({
      air_handler_id: "ah-1",
      heat_cool_runtime_seconds: 5 * 60,
      credited_runtime_seconds: 5 * 60,
    });
  });

  it("adds to an existing hourly row instead of replacing its accounting", async () => {
    findOne.mockResolvedValue({
      id: "ledger-1",
      heat_cool_runtime_seconds: 120,
      fan_only_runtime_seconds: 60,
      credited_runtime_seconds: 120,
      details: { attempted_blocks: 1 },
    });

    await recordFanRuntimeInterval({
      airHandlerId: "ah-1",
      timeZone: "UTC",
      interval: {
        startMs: Date.UTC(2026, 0, 1, 12, 10),
        endMs: Date.UTC(2026, 0, 1, 12, 15),
        kind: "fan_only",
      },
    });

    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][1]).toMatchObject({
      heat_cool_runtime_seconds: 120,
      fan_only_runtime_seconds: 360,
      credited_runtime_seconds: 420,
      details: { attempted_blocks: 1 },
    });
  });
});
