import { v4 as uuidv4 } from "uuid";
import type { IBasicEntity } from "~/server/types/common";

/**
 * Spreads a fresh id/creation_time/modified_time onto insert fields — both
 * reference apps hand-repeat this at every insert site instead. Append-only
 * tables (manual_overrides) get their "modified_time = creation_time on
 * insert" rule for free, since both are set from the same `now`.
 */
export function withTimestamps<T extends Record<string, unknown>>(
  fields: T,
  now: Date = new Date(),
): T & IBasicEntity {
  return { id: uuidv4(), creation_time: now, modified_time: now, ...fields };
}

/** For update sites: bumps modified_time only, leaving creation_time untouched. */
export function touch(
  now: Date = new Date(),
): Pick<IBasicEntity, "modified_time"> {
  return { modified_time: now };
}
