import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import type { VentHardwareType, ZoneConfig } from "~/shared/schemas/zoneConfig";
import type { ZoneRuntimeState } from "~/shared/types/zone";
import { Installation } from "~/server/database/models/installation";
import { AirHandler } from "~/server/database/models/airHandler";

export interface IZone {
  installation_id: string;
  air_handler_id: string;
  flair_room_id: string | null;
  name: string;
  vent_hardware_type: VentHardwareType;
  config: ZoneConfig;
  state: ZoneRuntimeState;
}

export const Zone = new EntitySchema<IBasicEntity & IZone>({
  name: "Zone",
  tableName: "zones",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false },
    air_handler_id: { type: "uuid", nullable: false },
    flair_room_id: {
      type: "varchar",
      length: 255,
      nullable: true,
      unique: true,
    },
    name: { type: "varchar", length: 255, nullable: false },
    vent_hardware_type: { type: "varchar", length: 50, nullable: false },
    config: { type: "jsonb", nullable: false },
    state: { type: "jsonb", nullable: false },
  },
  foreignKeys: [
    {
      name: "fk_zones_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
    {
      // RESTRICT (not CASCADE) so deleting a handler can't silently orphan
      // zones/schedule refs.
      name: "fk_zones_air_handler",
      columnNames: ["air_handler_id"],
      target: AirHandler,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
  indices: [
    { name: "idx_zones_installation", columns: ["installation_id"] },
    {
      // The retrofit-sync flow does a name-based match; also the only way
      // to prevent duplicate-name zones from a bad sync.
      name: "idx_zones_air_handler_name",
      columns: ["air_handler_id", "name"],
      unique: true,
    },
  ],
});
