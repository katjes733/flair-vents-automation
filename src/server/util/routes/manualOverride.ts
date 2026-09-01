import AppDataSource from "~/server/database/datasource";
import {
  resolveManualOverrideConfig,
  type ManualOverrideConfig,
} from "~/shared/schemas/manualOverride";

export interface ManualOverrideRow {
  zoneId: string;
  config: ManualOverrideConfig;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
}

interface RawRow {
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
        zoneId: row.zone_id,
        config: resolveManualOverrideConfig(row.config),
        expiresAtMs: row.expires_at ? row.expires_at.getTime() : null,
        revokedAtMs: row.revoked_at ? row.revoked_at.getTime() : null,
      },
    ]),
  );
}
