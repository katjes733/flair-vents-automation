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
