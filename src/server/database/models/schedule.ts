import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import type {
  ScheduleEvent,
  ScheduleConfig,
} from "~/shared/schemas/scheduleEvents";
import { Installation } from "~/server/database/models/installation";

export interface ISchedule {
  installation_id: string;
  name: string;
  events: ScheduleEvent[];
  config: ScheduleConfig;
}

export const Schedule = new EntitySchema<IBasicEntity & ISchedule>({
  name: "Schedule",
  tableName: "schedules",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false },
    name: { type: "varchar", length: 255, nullable: false, unique: true },
    // Evaluated entirely in app code, never SQL-filtered — a plain JSONB
    // array column is correct here (Data Model / schedules section).
    events: { type: "jsonb", nullable: false },
    config: { type: "jsonb", nullable: false },
  },
  foreignKeys: [
    {
      name: "fk_schedules_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
  indices: [
    { name: "idx_schedules_installation", columns: ["installation_id"] },
  ],
});
