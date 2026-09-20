import AppDataSource from "~/server/database/datasource";
import {
  bucketRuntimeByHour,
  type RuntimeInterval,
} from "~/server/domain/fanRuntime/scheduler";
import { touch, withTimestamps } from "~/server/util/entityTimestamps";
import type { FanRuntimeLedgerDetails } from "~/server/database/models/fanRuntimeLedger";

export interface FanRuntimeLedgerUpdate {
  airHandlerId: string;
  hourStartAt: Date;
  heatCoolRuntimeSeconds: number;
  fanOnlyRuntimeSeconds: number;
  creditedRuntimeSeconds: number;
  details?: FanRuntimeLedgerDetails;
}

export async function recordFanRuntimeInterval(params: {
  airHandlerId: string;
  interval: RuntimeInterval;
  timeZone: string;
}): Promise<void> {
  const buckets = bucketRuntimeByHour([params.interval], params.timeZone);
  for (const bucket of buckets) {
    const existing = await getFanRuntimeLedger(
      params.airHandlerId,
      new Date(bucket.hourStartMs),
    );
    await upsertFanRuntimeLedger({
      airHandlerId: params.airHandlerId,
      hourStartAt: new Date(bucket.hourStartMs),
      heatCoolRuntimeSeconds:
        (existing?.heatCoolRuntimeSeconds ?? 0) + bucket.heatCoolSeconds,
      fanOnlyRuntimeSeconds:
        (existing?.fanOnlyRuntimeSeconds ?? 0) + bucket.fanOnlySeconds,
      creditedRuntimeSeconds:
        (existing?.creditedRuntimeSeconds ?? 0) + bucket.creditedSeconds,
      details: existing?.details,
    });
  }
}

export async function upsertFanRuntimeLedger(
  update: FanRuntimeLedgerUpdate,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "FanRuntimeLedger",
  );
  const existing = await repo.findOne({
    where: {
      air_handler_id: update.airHandlerId,
      hour_start_at: update.hourStartAt,
    },
  });
  const fields = {
    air_handler_id: update.airHandlerId,
    hour_start_at: update.hourStartAt,
    heat_cool_runtime_seconds: update.heatCoolRuntimeSeconds,
    fan_only_runtime_seconds: update.fanOnlyRuntimeSeconds,
    credited_runtime_seconds: update.creditedRuntimeSeconds,
    details: update.details ?? {},
  };
  if (existing) {
    await repo.update(existing.id, { ...fields, ...touch() });
  } else {
    await repo.insert(withTimestamps(fields));
  }
}

export async function getFanRuntimeLedger(
  airHandlerId: string,
  hourStartAt: Date,
): Promise<{
  heatCoolRuntimeSeconds: number;
  fanOnlyRuntimeSeconds: number;
  creditedRuntimeSeconds: number;
  details: FanRuntimeLedgerDetails;
} | null> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "FanRuntimeLedger",
  );
  const record = await repo.findOne({
    where: { air_handler_id: airHandlerId, hour_start_at: hourStartAt },
  });
  if (!record) return null;
  return {
    heatCoolRuntimeSeconds: record.heat_cool_runtime_seconds,
    fanOnlyRuntimeSeconds: record.fan_only_runtime_seconds,
    creditedRuntimeSeconds: record.credited_runtime_seconds,
    details: record.details,
  };
}
