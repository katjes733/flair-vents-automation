import { redis } from "~/server/util/redis";
import { notifyOnce, clearNotification } from "~/server/util/notificationDedup";
import { sendEmail } from "~/server/util/mailing";

export interface AlertParams {
  key: string;
  subject: string;
  text: string;
  rateFloorMinutes: number;
  nowMs?: number;
}

export interface RecurringAlertParams {
  key: string;
  subject: string;
  text: string;
  intervalHours: number;
  nowMs?: number;
}

/**
 * The seam every alert-triggering call site (control/tick.ts, util/flair/
 * client.ts) goes through — real Redis/SMTP behind `createRedisAlertingClient`,
 * an in-memory fake for tests, exactly like ReconciliationQueue/
 * SpikeBufferStore/AirHandlerRuntimeStore. Without this seam, every
 * functional test that trips an alert condition would hit a real Redis
 * connection (a multi-second timeout per call with no Redis running) —
 * this is what keeps `bun test` Docker-free per the harness conventions.
 */
export interface AlertingClient {
  /** The dedup-and-quiet pattern most alerts use. Returns whether an email was actually sent. */
  alertOnce(params: AlertParams): Promise<boolean>;
  /** Clears an alertOnce key so the next occurrence fires again — call on recovery. */
  clearAlert(key: string): Promise<void>;
  /** Manual disarm's deliberate exception: re-fires on an interval, not dedup'd-and-quiet. */
  alertRecurring(params: RecurringAlertParams): Promise<boolean>;
  /** Clears an alertRecurring key so the next check starts a fresh interval. */
  clearRecurringAlert(key: string): Promise<void>;
}

// The in-process floor from "Email alerting": notifyOnce fails open if
// Redis is down, which combined with a 60s tick could mean dozens of
// emails/minute during an outage. This bounds that blast radius while
// keeping the fail-open guarantee — Redis being unreachable never
// silently drops a safety alert, it just can't be sent more than once per
// floor window per process. Deliberately per-key, not global, and
// deliberately in-process (not Redis-backed) since it exists specifically
// to cover the case where Redis itself is the thing that's down.
const rateFloorLastSentMs = new Map<string, number>();

export function createRedisAlertingClient(): AlertingClient {
  return {
    async alertOnce(params) {
      const nowMs = params.nowMs ?? Date.now();
      const floorMs = params.rateFloorMinutes * 60_000;
      const lastSentMs = rateFloorLastSentMs.get(params.key);
      if (lastSentMs !== undefined && nowMs - lastSentMs < floorMs) {
        return false;
      }
      const sent = await notifyOnce(
        params.key,
        () => sendEmail(params.subject, params.text),
        redis,
      );
      if (sent) rateFloorLastSentMs.set(params.key, nowMs);
      return sent;
    },
    async clearAlert(key) {
      await clearNotification(key, redis);
    },
    async alertRecurring(params) {
      const nowMs = params.nowMs ?? Date.now();
      const intervalMs = params.intervalHours * 60 * 60_000;
      const raw = await redis.get(params.key).catch(() => null);
      const lastSentMs = raw ? Number(raw) : null;
      if (lastSentMs !== null && nowMs - lastSentMs < intervalMs) {
        return false;
      }
      await sendEmail(params.subject, params.text);
      await redis.set(params.key, String(nowMs)).catch(() => {});
      return true;
    },
    async clearRecurringAlert(key) {
      await redis.del(key).catch(() => {});
    },
  };
}

/** In-memory fake for functional tests — records what would have been sent/cleared, no Redis/SMTP involved. */
export function createInMemoryAlertingClient(): AlertingClient & {
  getSentKeys(): ReadonlySet<string>;
  getSentSubjects(): readonly string[];
} {
  const sent = new Set<string>();
  const sentSubjects: string[] = [];
  const recurringLastSentMs = new Map<string, number>();

  return {
    async alertOnce(params) {
      if (sent.has(params.key)) return false;
      sent.add(params.key);
      sentSubjects.push(params.subject);
      return true;
    },
    async clearAlert(key) {
      sent.delete(key);
    },
    async alertRecurring(params) {
      const nowMs = params.nowMs ?? Date.now();
      const lastSentMs = recurringLastSentMs.get(params.key);
      if (
        lastSentMs !== undefined &&
        nowMs - lastSentMs < params.intervalHours * 60 * 60_000
      ) {
        return false;
      }
      recurringLastSentMs.set(params.key, nowMs);
      sentSubjects.push(params.subject);
      return true;
    },
    async clearRecurringAlert(key) {
      recurringLastSentMs.delete(key);
    },
    getSentKeys: () => sent,
    getSentSubjects: () => sentSubjects,
  };
}
