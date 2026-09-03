import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import type { ManualOverrideConfig } from "~/shared/schemas/manualOverride";
import { Installation } from "~/server/database/models/installation";
import { Zone } from "~/server/database/models/zone";

export interface IManualOverride {
  installation_id: string;
  zone_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  config: ManualOverrideConfig;
}

// Append-only, deliberately: an UPDATE would destroy exactly the "last-write-
// wins, logged clearly, visible after the fact" audit trail the spec asks
// for. "Currently active" is resolved with
// `DISTINCT ON (zone_id) ... ORDER BY zone_id, creation_time DESC` filtered
// to not-expired/not-revoked — see Data Model / manual_overrides.
export const ManualOverride = new EntitySchema<IBasicEntity & IManualOverride>({
  name: "ManualOverride",
  tableName: "manual_overrides",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false },
    zone_id: { type: "uuid", nullable: false },
    // Nullable, not a far-future sentinel — "permanent" is a real state.
    expires_at: { type: "timestamp with time zone", nullable: true },
    // Distinguishes explicit cancellation from natural expiry in the audit trail.
    revoked_at: { type: "timestamp with time zone", nullable: true },
    config: { type: "jsonb", nullable: false },
  },
  foreignKeys: [
    {
      name: "fk_manual_overrides_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
    {
      name: "fk_manual_overrides_zone",
      columnNames: ["zone_id"],
      target: Zone,
      referencedColumnNames: ["id"],
      onDelete: "CASCADE",
    },
  ],
  indices: [
    { name: "idx_manual_overrides_installation", columns: ["installation_id"] },
    // Backs the DISTINCT ON (zone_id) ... ORDER BY zone_id, creation_time DESC lookup.
    {
      name: "idx_manual_overrides_zone_creation",
      columns: ["zone_id", "creation_time"],
    },
  ],
});
