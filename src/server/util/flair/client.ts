import {
  getTokenWithClientCredentials,
  getTokenWithRefreshToken,
} from "~/server/util/auth";
import {
  getFlairTokenByInstallation,
  recordFlairRefreshError,
  upsertFlairToken,
} from "~/server/util/routes/flairToken";
import { recordTokenCall } from "~/server/util/flair/tokenBudget";
import { getRetryAfterMs } from "~/server/util/flair/rateLimit";
import {
  createOutageTracker,
  type OutageTracker,
} from "~/server/util/flair/outage";

// --- Semantic, fully-fakeable interface ---------------------------------
// Every domain/control test above this layer codes against these shapes,
// never raw JSON:API — see tests/helpers/fakeFlairClient.ts. Field names
// below are confirmed live via Phase 0 discovery (docs/flair-api-schema.md),
// not placeholders — this file was rewritten once real findings landed.

export interface FlairStructure {
  id: string;
  name: string;
  timeZone: string | null;
}

// A Flair "zone" — the actual "one air handler" concept. One structure
// contains multiple zones; each zone has its own thermostat and room set.
// See "Resource model — the critical correction" in docs/flair-api-schema.md.
export interface FlairZone {
  id: string;
  structureId: string;
  name: string;
  thermostatId: string | null;
}

// The real-time call-state resource — a thermostat's `current-state`.
// `ambientTemperatureC` is exactly this app's `thermostatReading` input for
// the Ecobee/Bosch offset-correction mechanism, already resolved by Flair
// regardless of which physical sensor is behind it.
export interface FlairThermostatState {
  thermostatId: string;
  operatingState: "cool" | "heat" | "idle" | "fan" | string;
  mode: string;
  ambientTemperatureC: number | null;
  targetTemperatureC: number | null;
  homeAway: string | null;
  fanState: string | null;
  online: boolean;
  written: boolean;
  writtenConfirmed: boolean;
  writtenFailures: number | null;
  createdAt: string;
}

export interface FlairRoom {
  id: string;
  zoneId: string | null;
  structureId: string;
  name: string;
  currentTemperatureC: number | null;
  setpointC: number | null;
  active: boolean;
  hasVents: boolean;
  hasPucks: boolean;
  hasRemoteSensors: boolean;
}

export interface FlairVent {
  id: string;
  roomId: string;
  percentOpen: number;
  inactive: boolean;
  voltage: number | null;
  currentRssi: number | null;
}

// A vent's own timestamped reading — a separate sub-resource
// (`vent-sensor-readings`), not embedded in the vent's own attributes.
// `ductTemperatureC` is the input `detectEquipmentFault()` needs.
export interface FlairVentReading {
  ventId: string;
  percentOpen: number;
  ductTemperatureC: number | null;
  createdAt: string;
}

// An Ecobee-side sensor (either a genuine SmartSensor, `is-tstat: false`,
// or the thermostat's own onboard sensor, `is-tstat: true`) — confirmed
// live via `GET /api/structures/{id}/remote-sensors`. `roomId` is how this
// joins to `FlairRoom`, mirroring `FlairVent.roomId`.
export interface FlairRemoteSensor {
  id: string;
  roomId: string | null;
  isTstat: boolean;
  sensorType: string;
  name: string;
}

// The occupancy signal lives here, not on FlairRemoteSensor itself — a
// separate `remote-sensor-readings` sub-resource, confirmed live via
// `GET /api/remote-sensors/{id}/current-reading`. This is exactly why an
// earlier discovery pass that only dumped `remote-sensors` (not its
// `current-reading`) missed it — the same "reading is a separate
// sub-resource" shape `FlairVentReading` already has for duct temperature.
export interface FlairRemoteSensorReading {
  remoteSensorId: string;
  occupied: boolean | null;
  temperatureC: number | null;
  humidity: number | null;
  createdAt: string;
}

export interface FlairClient {
  getAccessToken(): Promise<string>;
  fetchStructures(): Promise<FlairStructure[]>;
  fetchZones(structureId: string): Promise<FlairZone[]>;
  fetchThermostatState(thermostatId: string): Promise<FlairThermostatState>;
  fetchRooms(structureId: string): Promise<FlairRoom[]>;
  fetchVents(structureId: string): Promise<FlairVent[]>;
  fetchVentReading(ventId: string): Promise<FlairVentReading>;
  fetchRemoteSensors(structureId: string): Promise<FlairRemoteSensor[]>;
  fetchRemoteSensorReading(
    remoteSensorId: string,
  ): Promise<FlairRemoteSensorReading>;
  setVentPercentOpen(ventId: string, percentOpen: number): Promise<void>;
  setStructureSetpointC(structureId: string, setpointC: number): Promise<void>;
}

// Refresh only on demonstrated need — within this margin of the persisted
// expiry, not speculatively ahead of it. See "Token persistence" in the plan.
const TOKEN_SAFETY_MARGIN_MS = 2 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5000;

function baseUrl(): string {
  return process.env.FLAIR_API_BASE_URL || "https://api.flair.co";
}

export class FlairApiClient implements FlairClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRefreshPromise: Promise<string> | null = null;
  private readonly outage: OutageTracker;
  private readonly log: ReturnType<typeof logger.child>;

  constructor(private readonly installationId: string) {
    this.outage = createOutageTracker(installationId);
    this.log = logger.child({
      service: "flair",
      installation_id: installationId,
    });
  }

  async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.tokenExpiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()
    ) {
      return this.accessToken;
    }
    // Deduplicate concurrent refresh calls — several zones/handlers can ask
    // for a token in the same tick.
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }
    this.tokenRefreshPromise = this.mintOrRefreshToken().finally(() => {
      this.tokenRefreshPromise = null;
    });
    return this.tokenRefreshPromise;
  }

  private async mintOrRefreshToken(): Promise<string> {
    const stored = await getFlairTokenByInstallation(this.installationId);
    if (
      stored?.accessToken &&
      stored.expiresAt &&
      stored.expiresAt.getTime() - TOKEN_SAFETY_MARGIN_MS > Date.now()
    ) {
      this.accessToken = stored.accessToken;
      this.tokenExpiresAt = stored.expiresAt.getTime();
      return this.accessToken;
    }

    const grantMode = process.env.FLAIR_GRANT_MODE || "client_credentials";
    const response =
      grantMode === "refresh_token" && stored?.refreshToken
        ? await getTokenWithRefreshToken(stored.refreshToken)
        : await getTokenWithClientCredentials();

    const callsToday = await recordTokenCall();
    this.log.debug(
      { grant_type: grantMode, calls_today: callsToday },
      "Flair token call recorded",
    );

    if (!response.ok) {
      // A terminal failure (the grant itself is invalid) needs re-auth;
      // a transient one (network/5xx/rate-limit) doesn't — distinguished at
      // the first attempt, not after accumulating retries, per the plan.
      const terminal = response.status === 400 || response.status === 401;
      const errorMsg = `Flair token request failed: ${response.status} ${response.statusText}`;
      this.log.warn(
        { status: response.status, terminal },
        "Flair token refresh failed",
      );
      await recordFlairRefreshError(this.installationId, errorMsg);
      throw new Error(errorMsg);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    this.accessToken = tokenData.access_token;
    this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    await upsertFlairToken({
      installationId: this.installationId,
      accessToken: this.accessToken,
      refreshToken: tokenData.refresh_token ?? stored?.refreshToken ?? null,
      expiresAt: new Date(this.tokenExpiresAt),
      scope: tokenData.scope ?? null,
    });
    this.log.info("Flair token refreshed successfully");
    return this.accessToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path, baseUrl()).toString();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retryAfterMs =
        getRetryAfterMs(res) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
      this.log.debug(
        { endpoint: path, retry_after_ms: retryAfterMs },
        "Flair API error",
      );
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return this.request<T>(method, path, body);
    }

    if (!res.ok) {
      this.outage.recordFailure();
      this.log.warn({ endpoint: path, status: res.status }, "Flair API error");
      throw new Error(
        `Flair API error: ${method} ${path} -> ${res.status} ${res.statusText}`,
      );
    }

    this.outage.recordSuccess();
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // --- Resource methods, using field names confirmed live via Phase 0 -----

  async fetchStructures(): Promise<FlairStructure[]> {
    const body = await this.request<{
      data: Array<{ id: string; attributes: Record<string, unknown> }>;
    }>("GET", "/api/structures");
    return body.data.map((d) => ({
      id: d.id,
      name: String(d.attributes.name ?? ""),
      timeZone: (d.attributes["time-zone"] as string | undefined) ?? null,
    }));
  }

  async fetchZones(structureId: string): Promise<FlairZone[]> {
    const body = await this.request<{
      data: Array<{
        id: string;
        attributes: Record<string, unknown>;
        relationships?: { thermostat?: { data?: { id: string | null } } };
      }>;
    }>("GET", `/api/structures/${structureId}/zones`);
    return body.data.map((d) => ({
      id: d.id,
      structureId,
      name: String(d.attributes.name ?? ""),
      thermostatId: d.relationships?.thermostat?.data?.id ?? null,
    }));
  }

  async fetchThermostatState(
    thermostatId: string,
  ): Promise<FlairThermostatState> {
    const body = await this.request<{
      data: { attributes: Record<string, unknown> };
    }>("GET", `/api/thermostats/${thermostatId}/current-state`);
    const a = body.data.attributes;
    return {
      thermostatId,
      operatingState: String(a["operating-state"] ?? "idle"),
      mode: String(a.mode ?? ""),
      ambientTemperatureC:
        (a["ambient-temperature-c"] as number | undefined) ?? null,
      targetTemperatureC:
        (a["target-temperature-c"] as number | undefined) ?? null,
      homeAway: (a["home-away"] as string | undefined) ?? null,
      fanState: (a["fan-state"] as string | undefined) ?? null,
      online: Boolean(a.online ?? true),
      written: Boolean(a.written ?? false),
      writtenConfirmed: Boolean(a["written-confirmed"] ?? false),
      writtenFailures: (a["written-failures"] as number | undefined) ?? null,
      createdAt: String(a["created-at"] ?? ""),
    };
  }

  async fetchRooms(structureId: string): Promise<FlairRoom[]> {
    const body = await this.request<{
      data: Array<{
        id: string;
        attributes: Record<string, unknown>;
        relationships: {
          zones?: { data?: Array<{ id: string }> };
          vents?: { data?: unknown[] };
          pucks?: { data?: unknown[] };
          "remote-sensors"?: { data?: unknown[] };
        };
      }>;
    }>("GET", `/api/structures/${structureId}/rooms`);
    return body.data.map((d) => ({
      id: d.id,
      // Modeled as a single zone — the relationship is an array in the raw
      // API, but every room observed so far belongs to exactly one.
      zoneId: d.relationships.zones?.data?.[0]?.id ?? null,
      structureId,
      name: String(d.attributes.name ?? ""),
      // Rooms use `set-point-c`, distinct from the structure's own
      // `set-point-temperature-c` — a real, confirmed field-name difference,
      // not a typo.
      currentTemperatureC:
        (d.attributes["current-temperature-c"] as number | undefined) ?? null,
      setpointC: (d.attributes["set-point-c"] as number | undefined) ?? null,
      active: Boolean(d.attributes.active ?? true),
      hasVents: (d.relationships.vents?.data?.length ?? 0) > 0,
      hasPucks: (d.relationships.pucks?.data?.length ?? 0) > 0,
      hasRemoteSensors:
        (d.relationships["remote-sensors"]?.data?.length ?? 0) > 0,
    }));
  }

  async fetchVents(structureId: string): Promise<FlairVent[]> {
    const body = await this.request<{
      data: Array<{
        id: string;
        attributes: Record<string, unknown>;
        relationships?: { room?: { data?: { id: string } } };
      }>;
    }>("GET", `/api/structures/${structureId}/vents`);
    return body.data.map((d) => ({
      id: d.id,
      roomId: d.relationships?.room?.data?.id ?? "",
      percentOpen: Number(d.attributes["percent-open"] ?? 0),
      inactive: Boolean(d.attributes.inactive ?? false),
      voltage: (d.attributes.voltage as number | undefined) ?? null,
      currentRssi: (d.attributes["current-rssi"] as number | undefined) ?? null,
    }));
  }

  async fetchVentReading(ventId: string): Promise<FlairVentReading> {
    const body = await this.request<{
      data: { attributes: Record<string, unknown> };
    }>("GET", `/api/vents/${ventId}/current-reading`);
    const a = body.data.attributes;
    return {
      ventId,
      percentOpen: Number(a["percent-open"] ?? 0),
      ductTemperatureC: (a["duct-temperature-c"] as number | undefined) ?? null,
      createdAt: String(a["created-at"] ?? ""),
    };
  }

  async fetchRemoteSensors(structureId: string): Promise<FlairRemoteSensor[]> {
    const body = await this.request<{
      data: Array<{
        id: string;
        attributes: Record<string, unknown>;
        relationships?: { room?: { data?: { id: string | null } } };
      }>;
    }>("GET", `/api/structures/${structureId}/remote-sensors`);
    return body.data.map((d) => ({
      id: d.id,
      roomId: d.relationships?.room?.data?.id ?? null,
      isTstat: Boolean(d.attributes["is-tstat"]),
      sensorType: String(d.attributes["sensor-type"] ?? ""),
      name: String(d.attributes.name ?? ""),
    }));
  }

  async fetchRemoteSensorReading(
    remoteSensorId: string,
  ): Promise<FlairRemoteSensorReading> {
    const body = await this.request<{
      data: { attributes: Record<string, unknown> };
    }>("GET", `/api/remote-sensors/${remoteSensorId}/current-reading`);
    const a = body.data.attributes;
    return {
      remoteSensorId,
      occupied:
        a.occupied === undefined || a.occupied === null
          ? null
          : Boolean(a.occupied),
      temperatureC: (a["temperature-c"] as number | undefined) ?? null,
      humidity: (a.humidity as number | undefined) ?? null,
      createdAt: String(a["created-at"] ?? ""),
    };
  }

  async setVentPercentOpen(ventId: string, percentOpen: number): Promise<void> {
    await this.request("PATCH", `/api/vents/${ventId}`, {
      data: {
        type: "vents",
        id: ventId,
        attributes: { "percent-open": percentOpen },
      },
    });
  }

  // Writes to the STRUCTURE's setpoint — the only confirmed writable
  // setpoint path. With one zone active today this is equivalent to "the
  // air handler's setpoint," but it's genuinely unconfirmed whether a
  // second simultaneously-active zone would get its own independent value
  // or share this same one — see "Open items" in docs/flair-api-schema.md.
  // Re-verify before a second air handler goes live.
  async setStructureSetpointC(
    structureId: string,
    setpointC: number,
  ): Promise<void> {
    await this.request("PATCH", `/api/structures/${structureId}`, {
      data: {
        type: "structures",
        id: structureId,
        attributes: { "set-point-temperature-c": setpointC },
      },
    });
  }
}
