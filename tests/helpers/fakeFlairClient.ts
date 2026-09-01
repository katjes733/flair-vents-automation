import type {
  FlairClient,
  FlairStructure,
  FlairZone,
  FlairThermostatState,
  FlairRoom,
  FlairVent,
  FlairVentReading,
  FlairRemoteSensor,
  FlairRemoteSensorReading,
} from "~/server/util/flair/client";

// A stateful, in-memory fake — not HTTP mocking. Every domain/control test
// above the client layer codes against this (or the real FlairApiClient)
// interchangeably; scripted failures/rate-limits/degraded-or-frozen
// readings/equipment faults are all just fixture state here, not raw
// JSON:API payloads a test would otherwise have to hand-construct.

export interface VentCommand {
  ventId: string;
  percentOpen: number;
  at: number;
}

export interface SetpointCommand {
  structureId: string;
  setpointC: number;
  at: number;
}

export class FakeFlairClient implements FlairClient {
  private structures: FlairStructure[] = [];
  private zones: FlairZone[] = [];
  private thermostatStates = new Map<string, FlairThermostatState>();
  private rooms: FlairRoom[] = [];
  private vents: FlairVent[] = [];
  private ventReadings = new Map<string, FlairVentReading>();
  private remoteSensors: FlairRemoteSensor[] = [];
  private remoteSensorReadings = new Map<string, FlairRemoteSensorReading>();
  private forcedError: Error | null = null;
  private rateLimitedOnce = false;
  private readonly ventCommandHistory: VentCommand[] = [];
  private readonly setpointCommandHistory: SetpointCommand[] = [];
  private accessTokenCallCount = 0;

  // --- Fixture setup ------------------------------------------------------

  setStructures(structures: FlairStructure[]): void {
    this.structures = structures;
  }

  setZones(zones: FlairZone[]): void {
    this.zones = zones;
  }

  setThermostatState(state: FlairThermostatState): void {
    this.thermostatStates.set(state.thermostatId, state);
  }

  setRooms(rooms: FlairRoom[]): void {
    this.rooms = rooms;
  }

  setVents(vents: FlairVent[]): void {
    this.vents = vents;
  }

  setVentReading(reading: FlairVentReading): void {
    this.ventReadings.set(reading.ventId, reading);
  }

  setRemoteSensors(sensors: FlairRemoteSensor[]): void {
    this.remoteSensors = sensors;
  }

  setRemoteSensorReading(reading: FlairRemoteSensorReading): void {
    this.remoteSensorReadings.set(reading.remoteSensorId, reading);
  }

  /** The next call to any fetch/set method throws this error instead of succeeding. */
  failNextCallWith(error: Error): void {
    this.forcedError = error;
  }

  /** The next call throws a 429-shaped error once, mirroring a rate-limited response. */
  rateLimitNextCall(): void {
    this.rateLimitedOnce = true;
  }

  // --- Test assertions ------------------------------------------------------

  getVentCommandHistory(): readonly VentCommand[] {
    return this.ventCommandHistory;
  }

  getSetpointCommandHistory(): readonly SetpointCommand[] {
    return this.setpointCommandHistory;
  }

  getAccessTokenCallCount(): number {
    return this.accessTokenCallCount;
  }

  // --- FlairClient ------------------------------------------------------

  async getAccessToken(): Promise<string> {
    this.accessTokenCallCount += 1;
    this.maybeThrow();
    return "fake-access-token";
  }

  async fetchStructures(): Promise<FlairStructure[]> {
    this.maybeThrow();
    return this.structures;
  }

  async fetchZones(structureId: string): Promise<FlairZone[]> {
    this.maybeThrow();
    return this.zones.filter((z) => z.structureId === structureId);
  }

  async fetchThermostatState(
    thermostatId: string,
  ): Promise<FlairThermostatState> {
    this.maybeThrow();
    const state = this.thermostatStates.get(thermostatId);
    if (!state)
      throw new Error(`No fixture thermostat state set for ${thermostatId}`);
    return state;
  }

  async fetchRooms(structureId: string): Promise<FlairRoom[]> {
    this.maybeThrow();
    return this.rooms.filter((r) => r.structureId === structureId);
  }

  async fetchVents(structureId: string): Promise<FlairVent[]> {
    this.maybeThrow();
    const roomIds = new Set(
      this.rooms.filter((r) => r.structureId === structureId).map((r) => r.id),
    );
    return this.vents.filter((v) => roomIds.has(v.roomId));
  }

  async fetchVentReading(ventId: string): Promise<FlairVentReading> {
    this.maybeThrow();
    const reading = this.ventReadings.get(ventId);
    if (!reading) throw new Error(`No fixture vent reading set for ${ventId}`);
    return reading;
  }

  async fetchRemoteSensors(_structureId: string): Promise<FlairRemoteSensor[]> {
    this.maybeThrow();
    return this.remoteSensors;
  }

  async fetchRemoteSensorReading(
    remoteSensorId: string,
  ): Promise<FlairRemoteSensorReading> {
    this.maybeThrow();
    const reading = this.remoteSensorReadings.get(remoteSensorId);
    if (!reading)
      throw new Error(
        `No fixture remote-sensor reading set for ${remoteSensorId}`,
      );
    return reading;
  }

  async setVentPercentOpen(ventId: string, percentOpen: number): Promise<void> {
    this.maybeThrow();
    this.ventCommandHistory.push({ ventId, percentOpen, at: Date.now() });
    const vent = this.vents.find((v) => v.id === ventId);
    if (vent) {
      // Immediate reconciliation by default — tests simulating a degraded
      // vent should call setVents() afterward to pin the vent's own
      // percentOpen away from the commanded value instead.
      vent.percentOpen = percentOpen;
    }
  }

  async setStructureSetpointC(
    structureId: string,
    setpointC: number,
  ): Promise<void> {
    this.maybeThrow();
    this.setpointCommandHistory.push({
      structureId,
      setpointC,
      at: Date.now(),
    });
  }

  private maybeThrow(): void {
    if (this.rateLimitedOnce) {
      this.rateLimitedOnce = false;
      const err = new Error("Flair API error: rate limited") as Error & {
        status: number;
      };
      err.status = 429;
      throw err;
    }
    if (this.forcedError) {
      const err = this.forcedError;
      this.forcedError = null;
      throw err;
    }
  }
}
