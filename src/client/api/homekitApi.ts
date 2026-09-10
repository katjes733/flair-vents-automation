import { httpClient } from "~/client/api/httpClient";

export interface HomeKitStatus {
  paired: boolean;
  accessoryId?: string;
  pairedAt?: string;
  reachable?: boolean;
  lastConnectError?: string | null;
  lastConnectErrorAt?: string | null;
}

export interface DiscoveredAccessory {
  name: string;
  accessoryId: string;
}

// Mirrors sync.ts's own SyncDiffEntry discriminated-union shape (see
// syncApi.ts) — "Ecobee SmartSensor Reading via HomeKit".
export type SensorMatchEntry =
  | {
      kind: "already_mapped";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
      zoneId: string;
      zoneName: string;
    }
  | {
      kind: "unmapped_suggested";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
      suggestedZoneId: string;
      suggestedZoneName: string;
    }
  | {
      kind: "unmapped_new";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
    };

export async function fetchHomeKitStatus(
  airHandlerId: string,
): Promise<HomeKitStatus> {
  const { data } = await httpClient.get<HomeKitStatus>(
    `/air-handlers/${airHandlerId}/homekit/status`,
  );
  return data;
}

export async function discoverHomeKitAccessories(
  airHandlerId: string,
): Promise<DiscoveredAccessory[]> {
  const { data } = await httpClient.post<{
    accessories: DiscoveredAccessory[];
  }>(`/air-handlers/${airHandlerId}/homekit/discover`);
  return data.accessories;
}

export async function pairHomeKitAccessory(
  airHandlerId: string,
  accessoryId: string,
  setupCode: string,
): Promise<void> {
  await httpClient.post(`/air-handlers/${airHandlerId}/homekit/pair`, {
    accessoryId,
    setupCode,
  });
}

export async function unpairHomeKitAccessory(
  airHandlerId: string,
): Promise<void> {
  await httpClient.post(`/air-handlers/${airHandlerId}/homekit/unpair`);
}

export async function fetchHomeKitSensorMatches(
  airHandlerId: string,
): Promise<SensorMatchEntry[]> {
  const { data } = await httpClient.get<{ matches: SensorMatchEntry[] }>(
    `/air-handlers/${airHandlerId}/homekit/sensor-matches`,
  );
  return data.matches;
}
