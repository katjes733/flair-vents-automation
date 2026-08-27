import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";
import { Installation } from "~/server/database/models/installation";

export interface ISystemSettings {
  installation_id: string;
  config: SystemSettingsConfig;
}

// One row per installation — installation_id UNIQUE NOT NULL is a DB
// guarantee ("at most one settings row per installation"), not just a
// convention, per Data Model / Multi-tenancy. Superseded the earlier global
// `singleton boolean UNIQUE` design.
export const SystemSettings = new EntitySchema<IBasicEntity & ISystemSettings>({
  name: "SystemSettings",
  tableName: "system_settings",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false, unique: true },
    config: { type: "jsonb", nullable: false },
  },
  foreignKeys: [
    {
      name: "fk_system_settings_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
});
