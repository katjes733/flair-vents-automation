import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import {
  resolveManualOverrideConfig,
  type ManualOverrideConfig,
} from "~/shared/schemas/manualOverride";

export interface ManualOverrideRow {
  id: string;
  zoneId: string;
  config: ManualOverrideConfig;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
}

interface RawRow {
  id: string;
  zone_id: string;
  config: unknown;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/**
 * The latest override row per zone — `DISTINCT ON (zone_id) ... ORDER BY
 * zone_id, creation_time DESC`, per the Data Model's manual_overrides
 * section. Whether that latest row is still *active* (not expired/
 * revoked) is a domain decision (`resolveManualOverride`), not this
 * query's job — it always returns the most recent row, valid or not.
 */
export async function getLatestOverridesForZones(
  zoneIds: string[],
): Promise<Map<string, ManualOverrideRow>> {
  if (zoneIds.length === 0) return new Map();
  const repo = (await AppDataSource.getInstance()).getRepository(
    "ManualOverride",
  );
  const rows = (await repo
    .createQueryBuilder("mo")
    .distinctOn(["mo.zone_id"])
    .where("mo.zone_id IN (:...zoneIds)", { zoneIds })
    .orderBy("mo.zone_id", "ASC")
    .addOrderBy("mo.creation_time", "DESC")
    .getMany()) as unknown as RawRow[];

  return new Map(
    rows.map((row) => [
      row.zone_id,
      {
        id: row.id,
        zoneId: row.zone_id,
        config: resolveManualOverrideConfig(row.config),
        expiresAtMs: row.expires_at ? row.expires_at.getTime() : null,
        revokedAtMs: row.revoked_at ? row.revoked_at.getTime() : null,
      },
    ]),
  );
}

export async function createManualOverride(fields: {
  installationId: string;
  zoneId: string;
  config: ManualOverrideConfig;
  expiresAtMs: number | null;
}): Promise<ManualOverrideRow> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "ManualOverride",
  );
  // Append-only — never an UPDATE to a prior row, per the Data Model's
  // "last-write-wins, logged clearly, visible after the fact" rule.
  // modified_time = creation_time on insert, same as every append-only
  // table.
  const now = new Date();
  const row = withTimestamps(
    {
      installation_id: fields.installationId,
      zone_id: fields.zoneId,
      config: fields.config,
      expires_at:
        fields.expiresAtMs !== null ? new Date(fields.expiresAtMs) : null,
      revoked_at: null,
    },
    now,
  );
  await repo.insert(row);
  return {
    id: row.id,
    zoneId: row.zone_id,
    config: fields.config,
    expiresAtMs: fields.expiresAtMs,
    revokedAtMs: null,
  };
}

/**
 * Distinguishes explicit cancellation from natural expiry in the audit
 * trail — updates `revoked_at` on the existing row rather than inserting
 * a new one, since this is metadata *about* that decision, not a change
 * to what was decided (the append-only rule protects the latter).
 */
export async function revokeManualOverride(id: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "ManualOverride",
  );
  await repo.update(id, { revoked_at: new Date(), ...touch() });
}
