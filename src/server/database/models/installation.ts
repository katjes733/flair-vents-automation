import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IInstallation {
  name: string;
  // The whole-house/account link — one Flair "structure" per installation.
  // Confirmed 1:1 by Phase 0 discovery (this account has exactly one
  // structure); the per-air-handler link lives on air_handlers.flair_zone_id
  // instead, since a structure contains multiple zones. See
  // docs/flair-api-schema.md.
  flair_structure_id: string | null;
}

// The tenant boundary — one row per physical house/Flair account. Every
// tenant-owned table below carries installation_id, FK'd back to this.
export const Installation = new EntitySchema<IBasicEntity & IInstallation>({
  name: "Installation",
  tableName: "installations",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    name: { type: "varchar", length: 255, nullable: false },
    flair_structure_id: {
      type: "varchar",
      length: 255,
      nullable: true,
      unique: true,
    },
  },
});
