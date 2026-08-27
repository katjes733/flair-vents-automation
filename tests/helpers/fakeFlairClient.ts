import type {
  FlairClient,
  FlairStructure,
  FlairRoom,
  FlairVent,
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
  private rooms: FlairRoom[] = [];
  private vents: FlairVent[] = [];
  private forcedError: Error | null = null;
  private rateLimitedOnce = false;
  private readonly ventCommandHistory: VentCommand[] = [];
  private readonly setpointCommandHistory: SetpointCommand[] = [];
  private accessTokenCallCount = 0;

  // --- Fixture setup ------------------------------------------------------

  setStructures(structures: FlairStructure[]): void {
    this.structures = structures;
  }

  setRooms(rooms: FlairRoom[]): void {
    this.rooms = rooms;
  }

  setVents(vents: FlairVent[]): void {
    this.vents = vents;
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

  async setVentPercentOpen(ventId: string, percentOpen: number): Promise<void> {
    this.maybeThrow();
    this.ventCommandHistory.push({ ventId, percentOpen, at: Date.now() });
    const vent = this.vents.find((v) => v.id === ventId);
    if (vent) {
      // Immediate reconciliation by default — tests simulating a degraded
      // vent should call setVents() afterward to pin reportedPercentOpen
      // away from the commanded value instead.
      vent.percentOpen = percentOpen;
      vent.reportedPercentOpen = percentOpen;
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
