import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
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

export async function getZonesForInstallation(
  installationId: string,
): Promise<ZoneData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  const rows = (await repo.find({
    where: { installation_id: installationId },
  })) as ZoneRow[];
  return rows.map(toZoneData);
}

export async function getZoneById(id: string): Promise<ZoneData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  const row = (await repo.findOne({ where: { id } })) as ZoneRow | null;
  return row ? toZoneData(row) : null;
}

export async function createZone(fields: {
  installationId: string;
  airHandlerId: string;
  flairRoomId: string | null;
  name: string;
  ventHardwareType: VentHardwareType;
  config: ZoneConfig;
}): Promise<ZoneData> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  const row = withTimestamps({
    installation_id: fields.installationId,
    air_handler_id: fields.airHandlerId,
    flair_room_id: fields.flairRoomId,
    name: fields.name,
    vent_hardware_type: fields.ventHardwareType,
    config: fields.config,
    state: EMPTY_ZONE_RUNTIME_STATE,
  });
  await repo.insert(row);
  return toZoneData(row as unknown as ZoneRow);
}

export async function updateZone(
  id: string,
  fields: Partial<{
    airHandlerId: string;
    name: string;
    ventHardwareType: VentHardwareType;
    flairRoomId: string | null;
    config: ZoneConfig;
  }>,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  await repo.update(id, {
    ...(fields.airHandlerId !== undefined && {
      air_handler_id: fields.airHandlerId,
    }),
    ...(fields.name !== undefined && { name: fields.name }),
    ...(fields.ventHardwareType !== undefined && {
      vent_hardware_type: fields.ventHardwareType,
    }),
    ...(fields.flairRoomId !== undefined && {
      flair_room_id: fields.flairRoomId,
    }),
    ...(fields.config !== undefined && { config: fields.config }),
    ...touch(),
  });
}

export async function deleteZone(id: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("Zone");
  await repo.delete(id);
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
