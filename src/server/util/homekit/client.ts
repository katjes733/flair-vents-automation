import { HttpClient, IPDiscovery } from "hap-controller";
import type { PairingData } from "hap-controller";
import type { HapTargetHeatingCoolingState } from "~/server/domain/setpoint/homekitCharacteristicSelection";

// Standard HAP characteristic-type UUIDs — protocol-level constants, not
// per-device, confirmed against this app's own real unit and cited from
// HAP-NodeJS's own ServiceDefinitions.ts (see
// docs/homekit-ecobee-control-research.md). The per-device *iid* for each
// of these is resolved dynamically per accessory (see
// resolveThermostatCharacteristics below), never hardcoded — an iid is
// specific to one accessory's current configuration/firmware, unlike
// these type UUIDs.
const HAP_TYPE = {
  THERMOSTAT_SERVICE: "0000004A-0000-1000-8000-0026BB765291",
  TARGET_HEATING_COOLING_STATE: "00000033-0000-1000-8000-0026BB765291",
  CURRENT_TEMPERATURE: "00000011-0000-1000-8000-0026BB765291",
  TARGET_TEMPERATURE: "00000035-0000-1000-8000-0026BB765291",
  COOLING_THRESHOLD_TEMPERATURE: "0000000D-0000-1000-8000-0026BB765291",
  HEATING_THRESHOLD_TEMPERATURE: "00000012-0000-1000-8000-0026BB765291",
} as const;

export interface HomeKitCurrentState {
  currentTempC: number;
  targetMode: HapTargetHeatingCoolingState;
  heatThresholdC: number | null;
  coolThresholdC: number | null;
}

export interface HomeKitClient {
  /** Live check — attempts to actually connect/authenticate, not just "do we have stored bytes." */
  isPaired(): Promise<boolean>;
  getCurrentState(): Promise<HomeKitCurrentState>;
  setTargetTemperature(valueC: number): Promise<void>;
  setThresholdTemperature(
    which: "heat" | "cool",
    valueC: number,
  ): Promise<void>;
  /** Cleanly releases this admin's own pairing slot on the accessory, then the caller deletes the stored row. */
  removePairing(): Promise<void>;
}

const DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Finds an accessory's *current* address/port via mDNS, matched by its
 * stable HAP `id` — never assumed static. Addresses/ports were directly
 * observed to rotate live during this feature's own prototype (a code
 * screen opening/closing changed the port each time), so every connection
 * attempt must be prepared to rediscover, not just reuse a cached value
 * forever.
 */
export function discoverAccessory(
  accessoryId: string,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<{ address: string; port: number } | null> {
  return new Promise((resolve) => {
    const discovery = new IPDiscovery();
    let resolved = false;
    const finish = (result: { address: string; port: number } | null) => {
      if (resolved) return;
      resolved = true;
      discovery.stop();
      resolve(result);
    };
    discovery.on("serviceUp", (service) => {
      if (service.id === accessoryId) {
        finish({ address: service.address, port: service.port });
      }
    });
    discovery.start();
    setTimeout(() => {
      const known = discovery.list().find((s) => s.id === accessoryId);
      finish(known ? { address: known.address, port: known.port } : null);
    }, timeoutMs);
  });
}

/**
 * Lists every currently-advertising, still-unpaired HAP accessory — backs
 * the pairing dialog's "Discover" step. `sf` bit 0x01 (NOT_PAIRED) is the
 * same status flag confirmed live this session via `dns-sd -Z` — an
 * accessory with that bit set is free to pair with, one without it is
 * already claimed by something else (see docs/homekit-ecobee-control-research.md).
 */
export function discoverUnpairedAccessories(
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<Array<{ name: string; accessoryId: string }>> {
  return new Promise((resolve) => {
    const discovery = new IPDiscovery();
    discovery.start();
    setTimeout(() => {
      const found = discovery
        .list()
        .filter((s) => (s.sf & 0x01) === 0x01)
        .map((s) => ({ name: s.name, accessoryId: s.id }));
      discovery.stop();
      resolve(found);
    }, timeoutMs);
  });
}

interface ThermostatCharacteristicMap {
  aid: number;
  targetHeatingCoolingStateIid: number;
  currentTemperatureIid: number;
  targetTemperatureIid: number;
  coolingThresholdIid: number | null;
  heatingThresholdIid: number | null;
}

async function resolveThermostatCharacteristics(
  client: HttpClient,
): Promise<ThermostatCharacteristicMap> {
  const db = (await client.getAccessories()) as {
    accessories: Array<{
      aid: number;
      services: Array<{
        type: string;
        characteristics: Array<{ iid: number; type: string }>;
      }>;
    }>;
  };
  for (const accessory of db.accessories) {
    const thermostat = accessory.services.find(
      (s) =>
        normalizeType(s.type) === normalizeType(HAP_TYPE.THERMOSTAT_SERVICE),
    );
    if (!thermostat) continue;
    const find = (type: string) =>
      thermostat.characteristics.find(
        (c) => normalizeType(c.type) === normalizeType(type),
      )?.iid ?? null;
    const targetHeatingCoolingStateIid = find(
      HAP_TYPE.TARGET_HEATING_COOLING_STATE,
    );
    const currentTemperatureIid = find(HAP_TYPE.CURRENT_TEMPERATURE);
    const targetTemperatureIid = find(HAP_TYPE.TARGET_TEMPERATURE);
    if (
      !targetHeatingCoolingStateIid ||
      !currentTemperatureIid ||
      !targetTemperatureIid
    ) {
      throw new Error(
        "Thermostat service found but missing a required characteristic (TargetHeatingCoolingState/CurrentTemperature/TargetTemperature)",
      );
    }
    return {
      aid: accessory.aid,
      targetHeatingCoolingStateIid,
      currentTemperatureIid,
      targetTemperatureIid,
      coolingThresholdIid: find(HAP_TYPE.COOLING_THRESHOLD_TEMPERATURE),
      heatingThresholdIid: find(HAP_TYPE.HEATING_THRESHOLD_TEMPERATURE),
    };
  }
  throw new Error("No Thermostat service found on this HAP accessory");
}

// HAP type UUIDs are sometimes reported in their full 36-char form and
// sometimes shortened (e.g. "35" instead of "00000035-0000-1000-8000-
// 0026BB765291") depending on the accessory's own firmware — normalize to
// just the significant 8-hex-digit prefix before comparing.
function normalizeType(type: string): string {
  return type.length <= 8
    ? type.padStart(8, "0").toUpperCase()
    : type.slice(0, 8).toUpperCase();
}

/**
 * One-time pairing bootstrap — a standalone function, not a HomeKitClient
 * method, since it deliberately needs no existing pairing data at all
 * (the whole point is producing it for the first time). Invoked by the
 * pairing service/route, never part of the ongoing per-tick delivery
 * path.
 */
export async function pairHomeKitAccessory(
  accessoryId: string,
  setupCode: string,
): Promise<{ pairingData: PairingData; address: string; port: number }> {
  const discovered = await discoverAccessory(accessoryId);
  if (!discovered) {
    throw new Error(
      `Could not discover HAP accessory ${accessoryId} on the local network — is its HomeKit setup screen still open?`,
    );
  }
  const client = new HttpClient(
    accessoryId,
    discovered.address,
    discovered.port,
  );
  await client.pairSetup(setupCode);
  return {
    pairingData: client.getLongTermData() as PairingData,
    address: discovered.address,
    port: discovered.port,
  };
}

export class HapControllerClient implements HomeKitClient {
  private client: HttpClient | null = null;
  private characteristics: ThermostatCharacteristicMap | null = null;

  constructor(
    private readonly accessoryId: string,
    private readonly pairingData: PairingData,
    private cachedAddress: string | null,
    private cachedPort: number | null,
    private readonly onConnectionInfoUpdated?: (
      address: string,
      port: number,
    ) => void,
  ) {}

  private async connect(): Promise<HttpClient> {
    if (this.client) return this.client;

    const tryConnect = async (
      address: string,
      port: number,
    ): Promise<HttpClient> => {
      const client = new HttpClient(
        this.accessoryId,
        address,
        port,
        this.pairingData,
      );
      // A cheap, real request that fails fast (ECONNREFUSED) if this
      // address/port is stale — confirmed live this session that a
      // rotated port fails exactly this way, immediately, not by hanging.
      this.characteristics = await resolveThermostatCharacteristics(client);
      return client;
    };

    if (this.cachedAddress && this.cachedPort) {
      try {
        this.client = await tryConnect(this.cachedAddress, this.cachedPort);
        return this.client;
      } catch {
        // Fall through to rediscovery — the cached address/port is stale.
      }
    }

    const discovered = await discoverAccessory(this.accessoryId);
    if (!discovered) {
      throw new Error(
        `Could not discover HAP accessory ${this.accessoryId} on the local network`,
      );
    }
    this.client = await tryConnect(discovered.address, discovered.port);
    this.cachedAddress = discovered.address;
    this.cachedPort = discovered.port;
    this.onConnectionInfoUpdated?.(discovered.address, discovered.port);
    return this.client;
  }

  async isPaired(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentState(): Promise<HomeKitCurrentState> {
    const client = await this.connect();
    const chars = this.characteristics!;
    const ids = [
      `${chars.aid}.${chars.targetHeatingCoolingStateIid}`,
      `${chars.aid}.${chars.currentTemperatureIid}`,
    ];
    if (chars.coolingThresholdIid)
      ids.push(`${chars.aid}.${chars.coolingThresholdIid}`);
    if (chars.heatingThresholdIid)
      ids.push(`${chars.aid}.${chars.heatingThresholdIid}`);

    const result = (await client.getCharacteristics(ids, {
      meta: false,
      perms: false,
      type: false,
      ev: false,
    })) as { characteristics: Array<{ iid: number; value: number }> };
    const byIid = new Map(result.characteristics.map((c) => [c.iid, c.value]));

    return {
      targetMode: byIid.get(
        chars.targetHeatingCoolingStateIid,
      ) as HapTargetHeatingCoolingState,
      currentTempC: byIid.get(chars.currentTemperatureIid)!,
      coolThresholdC: chars.coolingThresholdIid
        ? (byIid.get(chars.coolingThresholdIid) ?? null)
        : null,
      heatThresholdC: chars.heatingThresholdIid
        ? (byIid.get(chars.heatingThresholdIid) ?? null)
        : null,
    };
  }

  async setTargetTemperature(valueC: number): Promise<void> {
    const client = await this.connect();
    const chars = this.characteristics!;
    await client.setCharacteristics({
      [`${chars.aid}.${chars.targetTemperatureIid}`]: valueC,
    });
  }

  async setThresholdTemperature(
    which: "heat" | "cool",
    valueC: number,
  ): Promise<void> {
    const client = await this.connect();
    const chars = this.characteristics!;
    const iid =
      which === "heat" ? chars.heatingThresholdIid : chars.coolingThresholdIid;
    if (!iid) {
      throw new Error(
        `This accessory does not expose a ${which} threshold characteristic`,
      );
    }
    await client.setCharacteristics({ [`${chars.aid}.${iid}`]: valueC });
  }

  async removePairing(): Promise<void> {
    const client = await this.connect();
    await client.removePairing(this.pairingData.iOSDevicePairingID);
  }
}
