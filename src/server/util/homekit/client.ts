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
  // Confirmed present on the real "Upstairs" unit — see
  // docs/homekit-ecobee-control-research.md §6. Read-only (`ev`-capable),
  // and — unlike Flair's own cloud-relayed operating-state — confirmed
  // live to keep working through a stretch where Flair's own value went
  // stale for over an hour. CURRENT_FAN_STATE's "Blowing Air" (2) value
  // is specifically what lets a real fan-only period be told apart from
  // genuine idle, which CURRENT_HEATING_COOLING_STATE alone can't do (it
  // only has Off/Heat/Cool, no fourth "fan" value).
  CURRENT_HEATING_COOLING_STATE: "0000000F-0000-1000-8000-0026BB765291",
  CURRENT_FAN_STATE: "000000AF-0000-1000-8000-0026BB765291",
  // Ecobee SmartSensor accessories — each is its own HAP accessory under
  // the same pairing as the thermostat (aid=1), not folded into it. All
  // confirmed live against the real "Upstairs" pairing's four SmartSensors
  // — see docs/homekit-ecobee-control-research.md §7.
  ACCESSORY_INFORMATION_SERVICE: "0000003E-0000-1000-8000-0026BB765291",
  SERIAL_NUMBER: "00000030-0000-1000-8000-0026BB765291",
  // The accessory's own HomeKit name (e.g. "Extra Den") — read alongside
  // Serial Number specifically for the matching dialog, since Name is what
  // a household member actually recognizes their room by, even though it's
  // never trusted as the mapping key itself (Name doesn't reliably match
  // Flair's own room name — see docs/homekit-ecobee-control-research.md
  // §7's "Extra Den" finding).
  NAME: "00000023-0000-1000-8000-0026BB765291",
  TEMPERATURE_SENSOR_SERVICE: "0000008A-0000-1000-8000-0026BB765291",
  OCCUPANCY_SENSOR_SERVICE: "00000086-0000-1000-8000-0026BB765291",
  OCCUPANCY_DETECTED: "00000071-0000-1000-8000-0026BB765291",
  MOTION_SENSOR_SERVICE: "00000085-0000-1000-8000-0026BB765291",
  MOTION_DETECTED: "00000022-0000-1000-8000-0026BB765291",
} as const;

export type HapCurrentFanState = 0 | 1 | 2;
export type HapCurrentHeatingCoolingState = 0 | 1 | 2;

export interface HomeKitCurrentState {
  currentTempC: number;
  targetMode: HapTargetHeatingCoolingState;
  // The live TargetTemperature characteristic's own current value — this
  // app's real, currently-held setpoint, read directly from the device
  // itself rather than relayed through Flair's own cloud (which can lag
  // or simply not reflect a change made directly on the thermostat/Ecobee
  // app — confirmed live, this session, the exact reason this delivery
  // path exists at all). Meaningful only in Heat/Cool mode (1/2); null in
  // Auto (3), where the threshold pair below is what's actually live.
  targetTemperatureC: number | null;
  heatThresholdC: number | null;
  coolThresholdC: number | null;
  // Real-time equipment/fan activity, read locally — see
  // docs/homekit-ecobee-control-research.md §6. Null only if this
  // accessory doesn't expose the characteristic at all (not expected on
  // this unit, but the threshold pair above sets the precedent for
  // treating an absent characteristic as "no signal," not an error).
  currentHeatingCoolingState: HapCurrentHeatingCoolingState | null;
  currentFanState: HapCurrentFanState | null;
}

// One Ecobee SmartSensor's live reading, keyed by its own Serial Number
// (never `aid` — see resolveSensorAccessories' own comment on why). A
// field is `null` when that particular characteristic isn't exposed by
// this accessory/firmware, mirroring HomeKitCurrentState's own convention
// for an absent-vs-error distinction. The two undocumented vendor
// "seconds since change" characteristics observed on these accessories
// (docs/homekit-ecobee-control-research.md §7) are deliberately not
// decoded here — never confirmed by any public spec, and explicitly
// never meant to be load-bearing for a control decision.
export interface HomeKitSensorReading {
  serial: string;
  // The accessory's own HomeKit name — "" if it doesn't expose one for
  // some reason (not expected in practice; every real accessory checked
  // has carried a Name characteristic). Optional in this type only so
  // fixtures/tests that don't care about display naming don't all need to
  // supply it — every real read populates it.
  name?: string;
  tempC: number | null;
  occupied: boolean | null;
  motion: boolean | null;
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
  /**
   * Every Ecobee SmartSensor accessory found under this pairing, keyed by
   * Serial Number — see "Ecobee SmartSensor Reading via HomeKit" in the
   * plan. Resolves to an empty map (never throws) if no such accessory is
   * found or none currently answers, mirroring getCurrentState()'s own
   * "an absent value reads as null, not as an exception" convention where
   * feasible — a caller with no zone mapped to a serial never needs to
   * distinguish "empty" from "unreachable."
   */
  getSensorReadings(): Promise<Map<string, HomeKitSensorReading>>;
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
  // The real device's own minStep for each writable temperature
  // characteristic (confirmed live: 0.1°C on the real "Upstairs" unit for
  // all three) — resolved from the accessory database itself rather than
  // hardcoded, since a write value not aligned to this step is silently
  // rejected by the device (see writeCharacteristic's own comment). Falls
  // back to 0.1 only if a characteristic genuinely reports no minStep at
  // all, which HAP's own spec doesn't actually allow for a numeric
  // characteristic but costs nothing to guard against.
  targetTemperatureMinStep: number;
  coolingThresholdIid: number | null;
  coolingThresholdMinStep: number;
  heatingThresholdIid: number | null;
  heatingThresholdMinStep: number;
  currentHeatingCoolingStateIid: number | null;
  currentFanStateIid: number | null;
}

const DEFAULT_TEMPERATURE_MIN_STEP = 0.1;

async function resolveThermostatCharacteristics(
  client: HttpClient,
): Promise<ThermostatCharacteristicMap> {
  const db = (await client.getAccessories()) as {
    accessories: Array<{
      aid: number;
      services: Array<{
        type: string;
        characteristics: Array<{ iid: number; type: string; minStep?: number }>;
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
      ) ?? null;
    const targetHeatingCoolingState = find(
      HAP_TYPE.TARGET_HEATING_COOLING_STATE,
    );
    const currentTemperature = find(HAP_TYPE.CURRENT_TEMPERATURE);
    const targetTemperature = find(HAP_TYPE.TARGET_TEMPERATURE);
    if (
      !targetHeatingCoolingState ||
      !currentTemperature ||
      !targetTemperature
    ) {
      throw new Error(
        "Thermostat service found but missing a required characteristic (TargetHeatingCoolingState/CurrentTemperature/TargetTemperature)",
      );
    }
    const coolingThreshold = find(HAP_TYPE.COOLING_THRESHOLD_TEMPERATURE);
    const heatingThreshold = find(HAP_TYPE.HEATING_THRESHOLD_TEMPERATURE);
    return {
      aid: accessory.aid,
      targetHeatingCoolingStateIid: targetHeatingCoolingState.iid,
      currentTemperatureIid: currentTemperature.iid,
      targetTemperatureIid: targetTemperature.iid,
      targetTemperatureMinStep:
        targetTemperature.minStep ?? DEFAULT_TEMPERATURE_MIN_STEP,
      coolingThresholdIid: coolingThreshold?.iid ?? null,
      coolingThresholdMinStep:
        coolingThreshold?.minStep ?? DEFAULT_TEMPERATURE_MIN_STEP,
      heatingThresholdIid: heatingThreshold?.iid ?? null,
      heatingThresholdMinStep:
        heatingThreshold?.minStep ?? DEFAULT_TEMPERATURE_MIN_STEP,
      currentHeatingCoolingStateIid:
        find(HAP_TYPE.CURRENT_HEATING_COOLING_STATE)?.iid ?? null,
      currentFanStateIid: find(HAP_TYPE.CURRENT_FAN_STATE)?.iid ?? null,
    };
  }
  throw new Error("No Thermostat service found on this HAP accessory");
}

// A characteristic write silently rejected by the device (e.g. a value not
// aligned to its own minStep) surfaces as HAP status 207 (Multi-Status),
// not a thrown error — hap-controller's own setCharacteristics() resolves
// normally for a 207 response, returning the parsed per-characteristic
// status codes rather than throwing. Confirmed live: this app pushed
// unrounded values (e.g. 21.204661939005074) against a real
// CoolingThresholdTemperature characteristic whose own minStep is 0.1, and
// every one of those writes was silently ignored for ~10 minutes — no
// exception, no homekit_error, nothing — until a later value happened to
// land close enough to a valid step to be accepted. Rounding (below) is
// the actual fix; this check is the safety net for whatever it doesn't
// catch (a real device-side rejection for some other reason).
export function roundToStep(valueC: number, step: number): number {
  if (!(step > 0)) return valueC;
  const rounded = Math.round(valueC / step) * step;
  // Clean up floating-point noise (e.g. 21.1/0.1 → 210.99999999999997)
  // without assuming a fixed decimal precision — derive it from the step
  // itself so a device with a coarser (e.g. 0.5) or finer step still
  // rounds cleanly.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(rounded.toFixed(decimals));
}

export function assertCharacteristicWriteSucceeded(
  result: unknown,
  aid: number,
  iid: number,
): void {
  const characteristics = (
    result as {
      characteristics?: Array<{
        aid?: unknown;
        iid?: unknown;
        status?: number;
      }>;
    }
  )?.characteristics;
  if (!Array.isArray(characteristics)) return; // the 204 (full-success) shape carries no status field at all
  const entry = characteristics.find(
    (c) => Number(c.aid) === aid && Number(c.iid) === iid,
  );
  if (entry && typeof entry.status === "number" && entry.status !== 0) {
    throw new Error(
      `HomeKit rejected the write to ${aid}.${iid} (HAP status ${entry.status})`,
    );
  }
}

// One Ecobee SmartSensor accessory's resolved characteristic iids —
// `serialIid` locates its Serial Number characteristic's *iid*, not its
// value (getAccessories() never returns live values, only the shape — see
// getSensorReadings()'s own two-phase comment). `temperatureIid`/
// `occupancyIid`/`motionIid` are independently nullable: an accessory may
// expose only a subset of these three services.
interface SensorAccessoryCharacteristics {
  aid: number;
  serialIid: number;
  // Nullable, unlike serialIid — a missing Name shouldn't disqualify an
  // otherwise-usable sensor accessory, it just falls back to "" for display.
  nameIid: number | null;
  temperatureIid: number | null;
  occupancyIid: number | null;
  motionIid: number | null;
}

/**
 * Every accessory under this pairing that exposes at least one of
 * TemperatureSensor/OccupancySensor/MotionSensor, alongside its own
 * AccessoryInformation Serial Number iid — the SmartSensor accessories,
 * confirmed live to sit as their own separate `aid`s under the same
 * pairing as the thermostat (docs/homekit-ecobee-control-research.md §7).
 * Unlike resolveThermostatCharacteristics (which stops at the first
 * match), this iterates every accessory, since a household can have
 * several SmartSensors under one pairing. An accessory with no Serial
 * Number characteristic is skipped outright — Serial Number, not `aid`,
 * is this app's own persisted mapping key (see homekit_sensor_serial's
 * own comment), so an accessory this app could never key a reading by is
 * not worth resolving further.
 */
function resolveSensorAccessories(db: {
  accessories: Array<{
    aid: number;
    services: Array<{
      type: string;
      characteristics: Array<{ iid: number; type: string }>;
    }>;
  }>;
}): SensorAccessoryCharacteristics[] {
  const result: SensorAccessoryCharacteristics[] = [];
  for (const accessory of db.accessories) {
    const infoService = accessory.services.find(
      (s) =>
        normalizeType(s.type) ===
        normalizeType(HAP_TYPE.ACCESSORY_INFORMATION_SERVICE),
    );
    const serialIid = infoService?.characteristics.find(
      (c) => normalizeType(c.type) === normalizeType(HAP_TYPE.SERIAL_NUMBER),
    )?.iid;
    const nameIid =
      infoService?.characteristics.find(
        (c) => normalizeType(c.type) === normalizeType(HAP_TYPE.NAME),
      )?.iid ?? null;
    const findIn = (
      service: (typeof accessory.services)[number] | undefined,
      type: string,
    ) =>
      service?.characteristics.find(
        (c) => normalizeType(c.type) === normalizeType(type),
      )?.iid ?? null;
    const temperatureIid = findIn(
      accessory.services.find(
        (s) =>
          normalizeType(s.type) ===
          normalizeType(HAP_TYPE.TEMPERATURE_SENSOR_SERVICE),
      ),
      HAP_TYPE.CURRENT_TEMPERATURE,
    );
    const occupancyIid = findIn(
      accessory.services.find(
        (s) =>
          normalizeType(s.type) ===
          normalizeType(HAP_TYPE.OCCUPANCY_SENSOR_SERVICE),
      ),
      HAP_TYPE.OCCUPANCY_DETECTED,
    );
    const motionIid = findIn(
      accessory.services.find(
        (s) =>
          normalizeType(s.type) ===
          normalizeType(HAP_TYPE.MOTION_SENSOR_SERVICE),
      ),
      HAP_TYPE.MOTION_DETECTED,
    );
    if (!serialIid || (!temperatureIid && !occupancyIid && !motionIid)) {
      continue;
    }
    result.push({
      aid: accessory.aid,
      serialIid,
      nameIid,
      temperatureIid,
      occupancyIid,
      motionIid,
    });
  }
  return result;
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
  private sensorAccessories: SensorAccessoryCharacteristics[] | null = null;

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
      `${chars.aid}.${chars.targetTemperatureIid}`,
    ];
    if (chars.coolingThresholdIid)
      ids.push(`${chars.aid}.${chars.coolingThresholdIid}`);
    if (chars.heatingThresholdIid)
      ids.push(`${chars.aid}.${chars.heatingThresholdIid}`);
    if (chars.currentHeatingCoolingStateIid)
      ids.push(`${chars.aid}.${chars.currentHeatingCoolingStateIid}`);
    if (chars.currentFanStateIid)
      ids.push(`${chars.aid}.${chars.currentFanStateIid}`);

    const result = (await client.getCharacteristics(ids, {
      meta: false,
      perms: false,
      type: false,
      ev: false,
    })) as { characteristics: Array<{ iid: number; value: number }> };
    const byIid = new Map(result.characteristics.map((c) => [c.iid, c.value]));

    const targetMode = byIid.get(
      chars.targetHeatingCoolingStateIid,
    ) as HapTargetHeatingCoolingState;
    return {
      targetMode,
      currentTempC: byIid.get(chars.currentTemperatureIid)!,
      // A real, confirmed bug found live: HAP always returns *some* value
      // for TargetTemperature regardless of mode — it's never actually
      // absent — but in Auto mode (3) that value is stale/non-authoritative
      // (confirmed live: it held 20.4°C/68.7°F, a value from before the
      // thermostat was last switched to Auto, while the real active
      // comfort range — CoolingThresholdTemperature — read 22.0°C/71.6°F).
      // This interface's own doc comment already stated the contract
      // ("null in Auto... where the threshold pair is what's actually
      // live"), but nothing enforced it — every caller downstream (the
      // `thermostat_current_setpoint` display, in particular) trusted a
      // non-null value unconditionally, which is never actually null while
      // in Auto mode, so it never fell back to the real threshold. Enforced
      // here, once, so the contract is real rather than aspirational.
      targetTemperatureC:
        targetMode === 3
          ? null
          : (byIid.get(chars.targetTemperatureIid) ?? null),
      coolThresholdC: chars.coolingThresholdIid
        ? (byIid.get(chars.coolingThresholdIid) ?? null)
        : null,
      heatThresholdC: chars.heatingThresholdIid
        ? (byIid.get(chars.heatingThresholdIid) ?? null)
        : null,
      currentHeatingCoolingState: chars.currentHeatingCoolingStateIid
        ? ((byIid.get(chars.currentHeatingCoolingStateIid) ??
            null) as HapCurrentHeatingCoolingState | null)
        : null,
      currentFanState: chars.currentFanStateIid
        ? ((byIid.get(chars.currentFanStateIid) ??
            null) as HapCurrentFanState | null)
        : null,
    };
  }

  async setTargetTemperature(valueC: number): Promise<void> {
    const client = await this.connect();
    const chars = this.characteristics!;
    const rounded = roundToStep(valueC, chars.targetTemperatureMinStep);
    const result = await client.setCharacteristics({
      [`${chars.aid}.${chars.targetTemperatureIid}`]: rounded,
    });
    assertCharacteristicWriteSucceeded(
      result,
      chars.aid,
      chars.targetTemperatureIid,
    );
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
    const minStep =
      which === "heat"
        ? chars.heatingThresholdMinStep
        : chars.coolingThresholdMinStep;
    const rounded = roundToStep(valueC, minStep);
    const result = await client.setCharacteristics({
      [`${chars.aid}.${iid}`]: rounded,
    });
    assertCharacteristicWriteSucceeded(result, chars.aid, iid);
  }

  async getSensorReadings(): Promise<Map<string, HomeKitSensorReading>> {
    const client = await this.connect();

    const fetchValues = async (
      accessories: SensorAccessoryCharacteristics[],
    ): Promise<{
      characteristics: Array<{ aid?: number; iid: number; value: unknown }>;
    }> => {
      const ids: string[] = [];
      for (const acc of accessories) {
        ids.push(`${acc.aid}.${acc.serialIid}`);
        if (acc.nameIid) ids.push(`${acc.aid}.${acc.nameIid}`);
        if (acc.temperatureIid) ids.push(`${acc.aid}.${acc.temperatureIid}`);
        if (acc.occupancyIid) ids.push(`${acc.aid}.${acc.occupancyIid}`);
        if (acc.motionIid) ids.push(`${acc.aid}.${acc.motionIid}`);
      }
      return (await client.getCharacteristics(ids, {
        meta: false,
        perms: false,
        type: false,
        ev: false,
      })) as {
        characteristics: Array<{ aid?: number; iid: number; value: unknown }>;
      };
    };

    const resolveAccessories = async (): Promise<
      SensorAccessoryCharacteristics[]
    > => {
      const db = (await client.getAccessories()) as Parameters<
        typeof resolveSensorAccessories
      >[0];
      return resolveSensorAccessories(db);
    };

    if (!this.sensorAccessories) {
      this.sensorAccessories = await resolveAccessories();
    }
    if (this.sensorAccessories.length === 0) return new Map();

    let result: {
      characteristics: Array<{ aid?: number; iid: number; value: unknown }>;
    };
    try {
      result = await fetchValues(this.sensorAccessories);
    } catch {
      // A cached accessory list can go stale (an accessory's aid was
      // reassigned, or it was removed from the pairing) — re-resolve
      // fresh once before giving up, mirroring connect()'s own
      // cached-address-then-rediscover fallback.
      this.sensorAccessories = await resolveAccessories();
      if (this.sensorAccessories.length === 0) return new Map();
      result = await fetchValues(this.sensorAccessories);
    }

    // Keyed by "aid.iid" — an iid is only unique *within* one accessory,
    // so a bare iid can collide across the several accessories queried in
    // this one batched call, unlike getCurrentState()'s single-accessory
    // query, where that collision can't happen.
    const byId = new Map(
      result.characteristics.map((c) => [`${c.aid}.${c.iid}`, c.value]),
    );
    const readings = new Map<string, HomeKitSensorReading>();
    for (const acc of this.sensorAccessories) {
      const serial = byId.get(`${acc.aid}.${acc.serialIid}`);
      if (typeof serial !== "string" || !serial) continue;
      readings.set(serial, {
        serial,
        name: acc.nameIid
          ? ((byId.get(`${acc.aid}.${acc.nameIid}`) as string | undefined) ??
            "")
          : "",
        tempC: acc.temperatureIid
          ? ((byId.get(`${acc.aid}.${acc.temperatureIid}`) as
              number | undefined) ?? null)
          : null,
        occupied: acc.occupancyIid
          ? Boolean(byId.get(`${acc.aid}.${acc.occupancyIid}`))
          : null,
        motion: acc.motionIid
          ? Boolean(byId.get(`${acc.aid}.${acc.motionIid}`))
          : null,
      });
    }
    return readings;
  }

  async removePairing(): Promise<void> {
    const client = await this.connect();
    await client.removePairing(this.pairingData.iOSDevicePairingID);
  }
}
