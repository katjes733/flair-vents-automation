import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import { AirHandler } from "~/server/database/models/airHandler";

export interface FanRuntimeLedgerDetails {
  attempted_blocks?: number;
  completed_blocks?: number;
  overshoot_seconds?: number;
  shortfall_seconds?: number;
  last_error?: string;
  [key: string]: unknown;
}

export interface IFanRuntimeLedger {
  air_handler_id: string;
  hour_start_at: Date;
  heat_cool_runtime_seconds: number;
  fan_only_runtime_seconds: number;
  credited_runtime_seconds: number;
  details: FanRuntimeLedgerDetails;
}

export const FanRuntimeLedger = new EntitySchema<
  IBasicEntity & IFanRuntimeLedger
>({
  name: "FanRuntimeLedger",
  tableName: "fan_runtime_ledgers",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    air_handler_id: { type: "uuid", nullable: false },
    hour_start_at: { type: "timestamp with time zone", nullable: false },
    heat_cool_runtime_seconds: { type: "integer", nullable: false, default: 0 },
    fan_only_runtime_seconds: { type: "integer", nullable: false, default: 0 },
    credited_runtime_seconds: { type: "integer", nullable: false, default: 0 },
    details: { type: "jsonb", nullable: false, default: "{}" },
  },
  foreignKeys: [
    {
      name: "fk_fan_runtime_ledgers_air_handler",
      columnNames: ["air_handler_id"],
      target: AirHandler,
      referencedColumnNames: ["id"],
      onDelete: "CASCADE",
    },
  ],
  indices: [
    {
      name: "uq_fan_runtime_ledgers_air_handler_hour",
      columns: ["air_handler_id", "hour_start_at"],
      unique: true,
    },
  ],
});
