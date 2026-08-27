import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IInstallation {
  name: string;
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
  },
});
