import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import { AirHandler } from "~/server/database/models/airHandler";

export interface IHomekitPairing {
  air_handler_id: string;
  // The HAP accessory's own stable identifier (its MAC-shaped "id" TXT
  // record field), not this app's own uuid — this is what a fresh mDNS
  // discovery is matched against to find the accessory's *current*
  // address/port, which were directly observed to rotate live during this
  // feature's own prototype (see docs/homekit-ecobee-control-research.md).
  accessory_id: string;
  // hap-controller's getLongTermData() — the Ed25519 pairing keypair,
  // encrypted at rest (enc:v1:<iv>:<tag>:<data>, same envelope
  // src/server/util/tokenCrypto.ts already uses for flair_tokens).
  pairing_data: string;
  // Opportunistic cache only, re-verified via a fresh mDNS discovery on
  // every connect attempt — never treated as authoritative on its own.
  last_known_address: string | null;
  last_known_port: number | null;
  paired_at: Date;
  last_connect_error: string | null;
  last_connect_error_at: Date | null;
}

// One pairing per air handler — a HomeKit pairing is genuinely
// one-per-physical-thermostat, unlike flair_tokens (one Flair account per
// installation), matching this app's own existing model where one air
// handler already represents one physical thermostat (flair_zone_id).
// ON DELETE RESTRICT mirrors every other tenant-owned FK in this schema —
// deleting an air handler with an active pairing is a deliberate, reviewed
// action, never a silent cascade.
export const HomekitPairing = new EntitySchema<IBasicEntity & IHomekitPairing>({
  name: "HomekitPairing",
  tableName: "homekit_pairings",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    air_handler_id: { type: "uuid", nullable: false, unique: true },
    accessory_id: { type: "varchar", length: 32, nullable: false },
    pairing_data: { type: "text", nullable: false },
    last_known_address: { type: "varchar", length: 255, nullable: true },
    last_known_port: { type: "integer", nullable: true },
    paired_at: { type: "timestamp with time zone", nullable: false },
    last_connect_error: { type: "varchar", nullable: true },
    last_connect_error_at: { type: "timestamp with time zone", nullable: true },
  },
  foreignKeys: [
    {
      name: "fk_homekit_pairings_air_handler",
      columnNames: ["air_handler_id"],
      target: AirHandler,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
});
