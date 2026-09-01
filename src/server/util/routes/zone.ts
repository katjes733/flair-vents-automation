import AppDataSource from "~/server/database/datasource";
import { touch } from "~/server/util/entityTimestamps";
import {
  resolveZoneConfig,
  type ZoneConfig,
  type VentHardwareType,
} from "~/shared/schemas/zoneConfig";
import {
  EMPTY_ZONE_RUNTIME_STATE,
  type ZoneRuntimeState,
} from "~/shared/types/zone";

export interface ZoneData {
  id: string;
  installationId: string;
  airHandlerId: string;
  flairRoomId: string | null;
  name: string;
  ventHardwareType: VentHardwareType;
  config: ZoneConfig;
  state: ZoneRuntimeState;
}

interface ZoneRow {
  id: string;
  installation_id: string;
  air_handler_id: string;
  flair_room_id: string | null;
  name: string;
  vent_hardware_type: VentHardwareType;
  config: unknown;
  state: unknown;
}

function toZoneData(row: ZoneRow): ZoneData {
  return {
    id: row.id,
    installationId: row.installation_id,
    airHandlerId: row.air_handler_id,
    flairRoomId: row.flair_room_id,
    name: row.name,
    ventHardwareType: row.vent_hardware_type,
    config: resolveZoneConfig(row.config),
    state: {
      ...EMPTY_ZONE_RUNTIME_STATE,
      ...(row.state as Partial<ZoneRuntimeState>),
    },
  };
}

export async function getZonesForAirHandler(
  airHandlerId: string,
): Promise<ZoneData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  const rows = (await repo.find({
    where: { air_handler_id: airHandlerId },
  })) as ZoneRow[];
  return rows.map(toZoneData);
}

/**
 * Written only on change — the caller (control/tick.ts) diff-checks
 * against the state it loaded at the start of the tick and only calls
 * this when something actually changed, per the Data Model's "written
 * only on change (diff-checked)" rule for zones.state.
 */
export async function updateZoneState(
  zoneId: string,
  state: ZoneRuntimeState,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  await repo.update(zoneId, { state, ...touch() });
}
