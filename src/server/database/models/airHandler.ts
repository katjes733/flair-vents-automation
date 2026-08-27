import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import type { AirHandlerConfig } from "~/shared/schemas/airHandlerConfig";
import { Installation } from "~/server/database/models/installation";

export interface IAirHandler {
  installation_id: string;
  flair_structure_id: string | null;
  name: string;
  active: boolean;
  config: AirHandlerConfig;
}

export const AirHandler = new EntitySchema<IBasicEntity & IAirHandler>({
  name: "AirHandler",
  tableName: "air_handlers",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false },
    flair_structure_id: {
      type: "varchar",
      length: 255,
      nullable: true,
      unique: true,
    },
    // Unique, not just indexed — DB-enforced no-duplicate-name, and the
    // human key in every log line/legend.
    name: { type: "varchar", length: 255, nullable: false, unique: true },
    active: { type: "boolean", default: true, nullable: false },
    config: { type: "jsonb", nullable: false },
  },
  foreignKeys: [
    {
      name: "fk_air_handlers_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
  indices: [
    {
      name: "idx_air_handlers_installation",
      columns: ["installation_id"],
    },
  ],
});
