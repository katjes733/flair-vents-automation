import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInMemoryAlertingClient } from "~/server/util/alerting";

const { redisExists, redisSet, redisDel, redisGet } = vi.hoisted(() => ({
  redisExists: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  redisGet: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({
  redis: { exists: redisExists, set: redisSet, del: redisDel, get: redisGet },
}));

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("~/server/util/mailing", () => ({ sendEmail }));

const { createRedisAlertingClient } = await import("~/server/util/alerting");

describe("createRedisAlertingClient — alertOnce/clearAlert", () => {
  beforeEach(() => {
    redisExists.mockReset().mockResolvedValue(0);
    redisSet.mockReset().mockResolvedValue(undefined);
    redisDel.mockReset().mockResolvedValue(undefined);
    sendEmail.mockReset();
  });

  it("sends and dedups via Redis", async () => {
    const client = createRedisAlertingClient();
    const sent = await client.alertOnce({
      key: "alert:test:1",
      subject: "Subject",
      text: "Body",
      rateFloorMinutes: 15,
      nowMs: 1_000_000,
    });
    expect(sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith("Subject", "Body");
    expect(redisSet).toHaveBeenCalledWith("alert:test:1", "1");
  });

  it("suppresses a second call within the in-process rate floor, even if Redis would have allowed it", async () => {
    const client = createRedisAlertingClient();
    const params = {
      key: "alert:test:floor",
      subject: "Subject",
      text: "Body",
      rateFloorMinutes: 15,
    };
    const first = await client.alertOnce({ ...params, nowMs: 1_000_000 });
    redisExists.mockResolvedValue(0); // Redis itself would still say "not sent"
    const second = await client.alertOnce({
      ...params,
      nowMs: 1_000_000 + 5 * 60_000, // 5 min later — inside the 15 min floor
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("allows sending again once the rate floor window has passed", async () => {
    const client = createRedisAlertingClient();
    const params = {
      key: "alert:test:floor2",
      subject: "Subject",
      text: "Body",
      rateFloorMinutes: 15,
    };
    await client.alertOnce({ ...params, nowMs: 1_000_000 });
    redisExists.mockResolvedValue(0);
    const later = await client.alertOnce({
      ...params,
      nowMs: 1_000_000 + 16 * 60_000,
    });
    expect(later).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("clearAlert deletes the dedup key", async () => {
    const client = createRedisAlertingClient();
    await client.clearAlert("alert:test:1");
    expect(redisDel).toHaveBeenCalledWith("alert:test:1");
  });
});

describe("createRedisAlertingClient — alertRecurring/clearRecurringAlert", () => {
  beforeEach(() => {
    redisGet.mockReset();
    redisSet.mockReset().mockResolvedValue(undefined);
    redisDel.mockReset().mockResolvedValue(undefined);
    sendEmail.mockReset();
  });

  it("sends on the first check and records the timestamp", async () => {
    redisGet.mockResolvedValue(null);
    const client = createRedisAlertingClient();
    const sent = await client.alertRecurring({
      key: "alert:disarm-reminder",
      subject: "Subject",
      text: "Body",
      intervalHours: 24,
      nowMs: 1_000_000,
    });
    expect(sent).toBe(true);
    expect(redisSet).toHaveBeenCalledWith("alert:disarm-reminder", "1000000");
  });

  it("re-fires once the interval has elapsed — the deliberate non-dedup exception", async () => {
    redisGet.mockResolvedValue("1000000");
    const client = createRedisAlertingClient();
    const sent = await client.alertRecurring({
      key: "alert:disarm-reminder",
      subject: "Subject",
      text: "Body",
      intervalHours: 24,
      nowMs: 1_000_000 + 25 * 60 * 60_000,
    });
    expect(sent).toBe(true);
  });

  it("stays quiet before the interval has elapsed", async () => {
    redisGet.mockResolvedValue("1000000");
    const client = createRedisAlertingClient();
    const sent = await client.alertRecurring({
      key: "alert:disarm-reminder",
      subject: "Subject",
      text: "Body",
      intervalHours: 24,
      nowMs: 1_000_000 + 1 * 60 * 60_000,
    });
    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("clearRecurringAlert deletes the interval key", async () => {
    const client = createRedisAlertingClient();
    await client.clearRecurringAlert("alert:disarm-reminder");
    expect(redisDel).toHaveBeenCalledWith("alert:disarm-reminder");
  });
});

describe("createInMemoryAlertingClient", () => {
  it("sends once and suppresses until cleared", async () => {
    const client = createInMemoryAlertingClient();
    const first = await client.alertOnce({
      key: "k1",
      subject: "S1",
      text: "T1",
      rateFloorMinutes: 15,
    });
    const second = await client.alertOnce({
      key: "k1",
      subject: "S1",
      text: "T1",
      rateFloorMinutes: 15,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(client.getSentKeys().has("k1")).toBe(true);

    await client.clearAlert("k1");
    const third = await client.alertOnce({
      key: "k1",
      subject: "S1",
      text: "T1",
      rateFloorMinutes: 15,
    });
    expect(third).toBe(true);
  });

  it("tracks recurring alerts on their own interval, independent of alertOnce", async () => {
    const client = createInMemoryAlertingClient();
    const first = await client.alertRecurring({
      key: "k2",
      subject: "S2",
      text: "T2",
      intervalHours: 24,
      nowMs: 0,
    });
    const second = await client.alertRecurring({
      key: "k2",
      subject: "S2",
      text: "T2",
      intervalHours: 24,
      nowMs: 60_000,
    });
    const third = await client.alertRecurring({
      key: "k2",
      subject: "S2",
      text: "T2",
      intervalHours: 24,
      nowMs: 25 * 60 * 60_000,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(true);
  });
});
