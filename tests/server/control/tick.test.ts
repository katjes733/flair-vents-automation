import { describe, it, expect, vi } from "vitest";
import {
  runTick,
  type TickContext,
  type TickDeps,
} from "~/server/control/tick";
import type { AirHandlerData } from "~/server/util/routes/airHandler";
import type { ZoneData } from "~/server/util/routes/zone";
import { resolveAirHandlerConfig } from "~/shared/schemas/airHandlerConfig";
import { resolveZoneConfig } from "~/shared/schemas/zoneConfig";
import { resolveSystemSettings } from "~/shared/schemas/systemSettings";
import {
  EMPTY_ZONE_RUNTIME_STATE,
  type ZoneRuntimeState,
  type VentRuntimeState,
} from "~/shared/types/zone";
import { createInMemoryReconciliationQueue } from "~/server/control/reconciliationQueue";
import { createInMemorySpikeBufferStore } from "~/server/control/spikeBuffer";
import { createInMemoryAirHandlerRuntimeStore } from "~/server/control/airHandlerRuntimeStore";
import { createInMemoryZoneDemandTrackingStore } from "~/server/control/zoneDemandTrackingStore";
import { createInMemoryAlertingClient } from "~/server/util/alerting";
import { FakeFlairClient } from "../../helpers/fakeFlairClient";

const STRUCTURE_ID = "structure-1";
const FLAIR_ZONE_ID = "flair-zone-1";
const NOW = Date.UTC(2024, 0, 1, 12, 0);

function makeAirHandler(
  overrides: Partial<AirHandlerData["config"]> = {},
): AirHandlerData {
  return {
    id: "ah-1",
    installationId: "inst-1",
    flairZoneId: FLAIR_ZONE_ID,
    name: "Upstairs",
    active: true,
    config: resolveAirHandlerConfig({
      tonnage_tons: 5,
      blower_rated_flow_rate_lps: 921,
      blower_rated_flow_rate_is_estimate: false,
      // Low enough that a single zone's default flow rate (47 L/s) always
      // clears it on its own — the pressure floor isn't what these tests
      // are exercising.
      minimum_aggregate_flow_lps: 5,
      minimum_aggregate_flow_is_estimate: false,
      ...overrides,
    }),
  };
}

function makeZone(params: {
  id: string;
  flairRoomId: string;
  // Defaults to this fixture file's own room-N/vent-N naming convention —
  // every existing call site follows it, so this keeps the diff for
  // adding flair_vents minimal. Pass explicitly for a multi-vent zone.
  flairVentIds?: string[];
  state?: Partial<ZoneRuntimeState>;
}): ZoneData {
  return {
    id: params.id,
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: params.flairRoomId,
    name: params.id,
    ventHardwareType: "flair_smart_vent",
    config: resolveZoneConfig({
      has_temperature_sensor: true,
      idle_baseline_position: 100,
      flair_vents: (
        params.flairVentIds ?? [params.flairRoomId.replace("room", "vent")]
      ).map((flair_vent_id) => ({ flair_vent_id })),
    }),
    state: { ...EMPTY_ZONE_RUNTIME_STATE, ...params.state },
  };
}

function makeVentState(
  flairVentId: string,
  overrides: Partial<Omit<VentRuntimeState, "flair_vent_id">> = {},
): VentRuntimeState {
  return {
    flair_vent_id: flairVentId,
    last_reported_position: null,
    degraded: false,
    degraded_since: null,
    reconcile_attempts: 0,
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<TickContext["settings"]> = {},
): TickContext {
  return {
    installationId: "inst-1",
    structureId: STRUCTURE_ID,
    settings: {
      ...resolveSystemSettings({}),
      home_timezone: "UTC",
      live_air_handler_ids: ["ah-1"], // promoted to live by default in these fixtures
      ...overrides,
    },
    schedules: [],
    overridesByZoneId: new Map(),
    globalDryRun: false,
  };
}

function makeDeps(
  client: FakeFlairClient,
  persisted: Map<string, ZoneRuntimeState>,
  nowMs: number,
): TickDeps {
  return {
    client,
    reconciliationQueue: createInMemoryReconciliationQueue(),
    spikeBufferStore: createInMemorySpikeBufferStore(),
    airHandlerRuntimeStore: createInMemoryAirHandlerRuntimeStore(),
    zoneDemandTrackingStore: createInMemoryZoneDemandTrackingStore(),
    alerting: createInMemoryAlertingClient(),
    persistZoneState: vi.fn(async (zoneId: string, patch) => {
      const current = persisted.get(zoneId) ?? EMPTY_ZONE_RUNTIME_STATE;
      persisted.set(zoneId, { ...current, ...patch });
    }),
    now: () => nowMs,
  };
}

function setupFlairFixture(
  client: FakeFlairClient,
  rooms: Array<{
    roomId: string;
    ventId: string;
    tempC: number;
    ductC: number;
    percentOpen: number;
    voltage?: number | null;
    currentRssi?: number | null;
  }>,
  operatingState: "cool" | "heat" | "fan" | "idle" = "cool",
) {
  client.setZones([
    {
      id: FLAIR_ZONE_ID,
      structureId: STRUCTURE_ID,
      name: "Upstairs",
      thermostatId: "therm-1",
    },
  ]);
  client.setThermostatState({
    thermostatId: "therm-1",
    operatingState,
    mode: "cool",
    ambientTemperatureC: 23,
    targetTemperatureC: 21,
    homeAway: "Home",
    fanState: null,
    online: true,
    written: false,
    writtenConfirmed: false,
    writtenFailures: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  });
  client.setRooms(
    rooms.map((r) => ({
      id: r.roomId,
      zoneId: FLAIR_ZONE_ID,
      structureId: STRUCTURE_ID,
      name: r.roomId,
      currentTemperatureC: r.tempC,
      setpointC: null,
      active: true,
      hasVents: true,
      hasPucks: false,
      hasRemoteSensors: false,
    })),
  );
  client.setVents(
    rooms.map((r) => ({
      id: r.ventId,
      roomId: r.roomId,
      name: r.ventId,
      percentOpen: r.percentOpen,
      inactive: false,
      voltage: r.voltage ?? null,
      currentRssi: r.currentRssi ?? null,
    })),
  );
  for (const r of rooms) {
    client.setVentReading({
      ventId: r.ventId,
      percentOpen: r.percentOpen,
      ductTemperatureC: r.ductC,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
  }
}

describe("runTick — no contention", () => {
  it("computes an independent, demanding position for each zone", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 23,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [
      makeZone({ id: "z1", flairRoomId: "room-1" }),
      makeZone({ id: "z2", flairRoomId: "room-2" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.hvac_state).toBe("COOLING_CALL");
    expect(
      decision.zones.find((z) => z.zone_id === "z1")?.vents[0]
        ?.commanded_position_pct,
    ).toBeGreaterThan(0);
    expect(
      client
        .getVentCommandHistory()
        .map((c) => c.ventId)
        .sort(),
    ).toEqual(["vent-1", "vent-2"]);
  });

  // Regression test: `temp_calibrated` was added to the tick decision
  // record specifically so Stage 13 Increment B's ZoneTemperatureChart can
  // be built from this already-info-level event instead of the debug-only
  // `Zone evaluated` (absent from production Loki at LOG_LEVEL=info) — see
  // "Stage 13, Increment B".
  it("carries each zone's calibrated reading on the tick decision record", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(
      decision.zones.find((z) => z.zone_id === "z1")?.temp_calibrated,
    ).toBe(24);
  });

  // Regression test: the narrative previously interpolated the tracked
  // zone's raw id (e.g. a UUID) directly rather than its name — confirmed
  // live via a screenshot showing "tracking 0b10ae8e-756a-..." on the
  // dashboard. `makeZone()`'s own fixture sets `name` equal to `id`, which
  // can't distinguish the two, so this test builds a zone directly with a
  // UUID-shaped id and a distinct, human-readable name.
  it("names the tracked zone by name in the narrative, not its raw id", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 25,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones: ZoneData[] = [
      {
        id: "0b10ae8e-756a-494c-ad1e-d5a9e92715dd",
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: "room-1",
        name: "Den back",
        ventHardwareType: "flair_smart_vent",
        config: resolveZoneConfig({
          has_temperature_sensor: true,
          flair_vents: [{ flair_vent_id: "vent-1" }],
        }),
        state: { ...EMPTY_ZONE_RUNTIME_STATE },
      },
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.narrative).toContain("Den back");
    expect(decision.narrative).not.toContain(
      "0b10ae8e-756a-494c-ad1e-d5a9e92715dd",
    );
  });
});

// Regression test for a real gap found live via a user screenshot: an
// occupied, satisfied bedroom's vent stayed pinned at 100% indefinitely
// during a real cooling call driven by a different, still-demanding zone
// — nothing corrected it as it kept getting colder past its own setpoint.
// See "the goal is staying as close to target as possible at all times" —
// a satisfied zone now closes proportionally toward its floor regardless
// of occupancy, exactly like the demanding side ramps up.
describe("runTick — a satisfied zone closes down during someone else's active call", () => {
  it("closes an occupied, already-cold bedroom instead of leaving it pinned at its idle baseline", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-bedroom",
        ventId: "vent-bedroom",
        tempC: 15, // well past satisfied — should close hard toward the floor
        ductC: 14,
        percentOpen: 100,
      },
      {
        roomId: "room-office",
        ventId: "vent-office",
        tempC: 30, // keeps the call genuinely active
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [
      makeZone({ id: "z-bedroom", flairRoomId: "room-bedroom" }),
      makeZone({ id: "z-office", flairRoomId: "room-office" }),
    ];
    const ctx = makeCtx();
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Sleep Mode for the bedroom",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z-bedroom",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: true,
              },
              {
                zone_id: "z-office",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, new Map(), NOW),
    );

    expect(decision.hvac_state).toBe("COOLING_CALL");
    const bedroom = decision.zones.find((z) => z.zone_id === "z-bedroom");
    expect(bedroom?.classification).toBe("satisfied");
    expect(bedroom?.occupied).toBe(true);
    expect(bedroom?.vents[0]?.commanded_position_pct).toBeLessThan(100);
  });

  // Regression test for the exact live sequence that exposed this: a
  // short-cycling system kept yanking a closing bedroom back open to
  // idle_baseline_position every time the compressor cycled to IDLE, then
  // had to re-close from scratch next cycle — it never actually settled.
  // Confirmed via real production data: desired 100 -> 90 -> 80 (closing,
  // COOLING_CALL) -> 90 -> 100 (reset, the instant IDLE hit).
  it("doesn't reopen an occupied, satisfied zone just because the compressor cycles to IDLE mid-close", async () => {
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Sleep Mode for the bedroom",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z-bedroom",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: true,
              },
            ],
          },
        ],
      },
    ];
    const zones = [makeZone({ id: "z-bedroom", flairRoomId: "room-bedroom" })];

    // Tick 1: a real, active cooling call, bedroom already satisfied and
    // closing down (matches the earlier test's own scenario).
    const client1 = new FakeFlairClient();
    setupFlairFixture(
      client1,
      [
        {
          roomId: "room-bedroom",
          ventId: "vent-bedroom",
          tempC: 15,
          ductC: 14,
          percentOpen: 100,
        },
      ],
      "cool",
    );
    const decision1 = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client1, persisted, NOW),
    );
    const closedPosition = decision1.zones[0]?.vents[0]?.commanded_position_pct;
    expect(decision1.hvac_state).toBe("COOLING_CALL");
    expect(closedPosition).toBeLessThan(100);

    // Tick 2: the compressor cycles to IDLE, nothing else changes — the
    // *same* persisted runtime state carries the ramp forward. The old,
    // buggy behavior would jump this straight back toward 100
    // (idle_baseline_position, since the zone is occupied); the fix keeps
    // it continuing from (or at) where it already was.
    const client2 = new FakeFlairClient();
    setupFlairFixture(
      client2,
      [
        {
          roomId: "room-bedroom",
          ventId: "vent-bedroom",
          tempC: 15,
          ductC: 14,
          percentOpen: closedPosition ?? 100,
        },
      ],
      "idle",
    );
    const decision2 = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client2, persisted, NOW + 60_000),
    );

    expect(decision2.hvac_state).toBe("IDLE");
    expect(decision2.zones[0]?.classification).toBe("satisfied");
    expect(
      decision2.zones[0]?.vents[0]?.commanded_position_pct,
    ).toBeLessThanOrEqual(closedPosition!);
  });
});

describe("runTick — FAN_ONLY/IDLE baselines", () => {
  it("scales an unoccupied zone's idle baseline down, but leaves an occupied (Sleep Mode) zone's baseline unscaled", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-unocc",
          ventId: "vent-unocc",
          tempC: 22,
          ductC: 14,
          percentOpen: 100,
        },
        {
          roomId: "room-occ",
          ventId: "vent-occ",
          tempC: 22,
          ductC: 14,
          percentOpen: 100,
        },
      ],
      "fan", // FAN_ONLY — no active call, reported confidence
    );
    const zones = [
      makeZone({ id: "z-unocc", flairRoomId: "room-unocc" }),
      makeZone({ id: "z-occ", flairRoomId: "room-occ" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ unoccupied_idle_factor: 0.5 });
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Sleep Mode for z-occ",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z-occ",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: true,
              },
            ],
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.hvac_state).toBe("FAN_ONLY");
    expect(decision.call_confidence).toBe("reported");
    expect(
      decision.zones.find((z) => z.zone_id === "z-unocc")?.vents[0]
        ?.commanded_position_pct,
    ).toBe(50); // idle_baseline_position(100) * unoccupied_idle_factor(0.5)
    expect(
      decision.zones.find((z) => z.zone_id === "z-occ")?.vents[0]
        ?.commanded_position_pct,
    ).toBe(100); // occupied (Sleep Mode) — unscaled
  });

  // Regression test for a real bug found live via shadow-mode evaluation:
  // `tick.ts` passed `hvac.state as "COOLING_CALL" | "HEATING_CALL"` into
  // resolveZoneTargets — a cast that lied whenever the real state was
  // IDLE/FAN_ONLY. Since `"IDLE" === "COOLING_CALL"` is false,
  // resolveZoneTargets's cool/heat ternary silently fell through to the
  // *heat* setpoint on every such tick — for a cooling-only household,
  // every idle gap between cooling cycles briefly resolved (and logged)
  // the wrong setpoint. Confirmed against real production data: a zone's
  // `resolved_setpoint` flipped to its configured heat_setpoint in
  // lockstep with the AC cycling to IDLE, self-correcting the moment a
  // real call resumed.
  it("resolves the cool setpoint during FAN_ONLY, never the heat setpoint", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 22,
          ductC: 14,
          percentOpen: 100,
        },
      ],
      "fan", // FAN_ONLY — no active call, reported confidence
    );
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const ctx = makeCtx();
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Day",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, new Map(), NOW),
    );

    expect(decision.hvac_state).toBe("FAN_ONLY");
    expect(
      decision.zones.find((z) => z.zone_id === "z1")?.resolved_setpoint,
    ).toBe(21);
  });
});

describe("runTick — mixed vent hardware types", () => {
  it("counts a manual vent in the pressure aggregate at its fixed position, and excludes a no_vent zone from allocation without commanding it", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-smart",
        ventId: "vent-smart",
        tempC: 30,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones: ZoneData[] = [
      makeZone({ id: "z-smart", flairRoomId: "room-smart" }),
      {
        id: "z-manual",
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "z-manual",
        ventHardwareType: "manual_fixed_vent",
        config: resolveZoneConfig({
          has_temperature_sensor: false,
          manual_vents: [{ position: 40 }],
        }),
        state: { ...EMPTY_ZONE_RUNTIME_STATE },
      },
      {
        id: "z-no-vent",
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "z-no-vent",
        ventHardwareType: "no_vent",
        config: resolveZoneConfig({ has_temperature_sensor: false }),
        state: { ...EMPTY_ZONE_RUNTIME_STATE },
      },
    ];
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    // Neither non-smart-vent zone is ever dispatched — no vent exists to
    // command for either one.
    expect(client.getVentCommandHistory().map((c) => c.ventId)).toEqual([
      "vent-smart",
    ]);
    expect(decision.zones.find((z) => z.zone_id === "z-manual")?.vents).toEqual(
      [],
    );
    expect(
      decision.zones.find((z) => z.zone_id === "z-no-vent")?.vents,
    ).toEqual([]);
    // The manual vent's fixed position is real airflow the pressure math
    // must still account for — never zero, never excluded like no_vent.
    expect(decision.pressure?.aggregate_open_lps).toBeGreaterThan(0);
  });

  // Regression test: a no_vent zone linked to a real, sensored Flair room
  // (imported via the Sync Engine — see "Flair Sync Engine") previously
  // never had its reading/classification persisted at all, because Step
  // 15's persistZoneState call lived inside the vent-dispatch loop, which
  // `continue`d past every no_vent zone before ever reaching it. Found
  // live: an imported sensored, vent-less zone showed no reading in the
  // UI, tick after tick.
  it("persists a real reading and classification for a no_vent zone with a sensored room", async () => {
    const client = new FakeFlairClient();
    client.setZones([
      {
        id: FLAIR_ZONE_ID,
        structureId: STRUCTURE_ID,
        name: "Upstairs",
        thermostatId: "therm-1",
      },
    ]);
    client.setThermostatState({
      thermostatId: "therm-1",
      operatingState: "cool",
      mode: "cool",
      ambientTemperatureC: 23,
      targetTemperatureC: 21,
      homeAway: "Home",
      fanState: null,
      online: true,
      written: false,
      writtenConfirmed: false,
      writtenFailures: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    client.setRooms([
      {
        id: "room-sensor-only",
        zoneId: FLAIR_ZONE_ID,
        structureId: STRUCTURE_ID,
        name: "Den back",
        currentTemperatureC: 25,
        setpointC: null,
        active: true,
        hasVents: false,
        hasPucks: false,
        hasRemoteSensors: true,
      },
    ]);
    client.setVents([]);

    const zones: ZoneData[] = [
      {
        id: "z-no-vent",
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: "room-sensor-only",
        name: "Den back",
        ventHardwareType: "no_vent",
        config: resolveZoneConfig({ has_temperature_sensor: true }),
        state: { ...EMPTY_ZONE_RUNTIME_STATE },
      },
    ];
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(
      decision.zones.find((z) => z.zone_id === "z-no-vent")?.classification,
    ).toBe("demanding");
    expect(persisted.get("z-no-vent")?.last_reading_value).toBe(25);
    expect(persisted.get("z-no-vent")?.last_classification).toBe("demanding");
  });
});

describe("runTick — HVAC extended call with no improvement", () => {
  it("alerts once the call has run past the threshold with no shrinking deviation", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      // 24°C vs. the default 23.89°C fallback setpoint is a tiny, easy
      // deviation — swapped for a schedule below with a colder setpoint
      // so the deviation is large and unambiguous.
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ hvac_no_improvement_alert_minutes: 75 });
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Fixed setpoint",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21, // 24°C - 21°C = 3°C deviation
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ];
    const deps = makeDeps(client, persisted, NOW);
    // The call has been running 80 minutes (past the 75-minute threshold)
    // and the worst deviation at call-start was already 3°C — identical
    // to right now, i.e. genuinely no improvement.
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 80 * 60000,
      worstDeviationAtCallStartC: 3,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    await runTick(makeAirHandler(), zones, ctx, deps);

    const alerting = deps.alerting as ReturnType<
      typeof createInMemoryAlertingClient
    >;
    expect(alerting.getSentKeys().has("alert:hvacNoImprovement:ah-1")).toBe(
      true,
    );
  });

  it("stays quiet once the deviation has genuinely shrunk", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 22,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ hvac_no_improvement_alert_minutes: 75 });
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Fixed setpoint",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21, // 22°C - 21°C = 1°C deviation now — down from 3°C
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ];
    const deps = makeDeps(client, persisted, NOW);
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 80 * 60000,
      worstDeviationAtCallStartC: 3,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    await runTick(makeAirHandler(), zones, ctx, deps);

    const alerting = deps.alerting as ReturnType<
      typeof createInMemoryAlertingClient
    >;
    expect(alerting.getSentKeys().has("alert:hvacNoImprovement:ah-1")).toBe(
      false,
    );
  });
});

describe("runTick — emergency fail-safe", () => {
  it("forces every smart vent to 100% and bypasses the normal pipeline once a fault is detected", async () => {
    const client = new FakeFlairClient();
    // Duct temp close to room temp on every zone — nobody shows the
    // expected cooling differential.
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 23,
        percentOpen: 20,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    // Pre-seed the runtime store as if the call has already been running
    // for 20 minutes — past the default 10-minute grace period.
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 20 * 60000,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.narrative).toMatch(/Emergency fail-safe/);
    expect(client.getVentCommandHistory()[0]).toMatchObject({
      ventId: "vent-1",
      percentOpen: 100,
    });
    // See "Stage 12 — Current-Status Diagnostics" — EquipmentFaultLog's
    // current-status view reads this straight off the tick decision.
    expect(decision.equipment_fault_active).toBe(true);
    // The fault short-circuit fetches no live Flair snapshot, so there's
    // no calibrated reading to report — null, not a stale/fabricated value.
    expect(decision.zones[0].temp_calibrated).toBeNull();
  });
});

describe("runTick — hardware diagnostics (voltage/RSSI)", () => {
  it("threads a vent's battery voltage and RSSI through to the tick decision", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 22,
        ductC: 12,
        percentOpen: 50,
        voltage: 3.18,
        currentRssi: -69,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    const vent = decision.zones[0].vents.find(
      (v) => v.flair_vent_id === "vent-1",
    );
    expect(vent?.voltage).toBe(3.18);
    expect(vent?.current_rssi).toBe(-69);
  });
});

describe("runTick — equipment_fault_active reflects the real fault state", () => {
  it("is false on an ordinary tick with no fault", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 22,
        ductC: 12,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.equipment_fault_active).toBe(false);
  });
});

describe("runTick — stale sensor safeguard", () => {
  it("excludes a frozen reading from the position pipeline and closes it toward its floor", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        // Clearly demanding against the fallback cool setpoint (23.89°C)
        // even once minimum_comfort_tolerance_c's default 0.56°C floor is
        // applied — 24°C (deviation 0.11) used to be enough to read as
        // demanding under the old implicit-zero tolerance, but now floors
        // to "satisfied", which would incorrectly trip classifyStaleness's
        // own "not already satisfied" gate and mask the very staleness
        // this test exists to exercise.
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ stale_threshold_minutes: 1 });

    // Tick 1: establishes a baseline reading.
    const deps1 = makeDeps(client, persisted, NOW);
    await runTick(makeAirHandler(), zones, ctx, deps1);

    // Tick 2, two minutes later, same unchanged reading — now stale.
    const zonesTick2 = [
      makeZone({ id: "z1", flairRoomId: "room-1", state: persisted.get("z1") }),
    ];
    const deps2 = makeDeps(client, persisted, NOW + 2 * 60000);
    const decision2 = await runTick(makeAirHandler(), zonesTick2, ctx, deps2);

    const zoneDecision = decision2.zones.find((z) => z.zone_id === "z1");
    // Excluded from Steps 1-3 — ramping toward its floor (min_vent_position,
    // default 0) instead of continuing to chase the frozen "demanding"
    // reading, which held it at 100 on tick 1. Step 2's own ramp limiting
    // means it doesn't reach 0 in a single tick — the ramp-toward-floor
    // direction is the property under test here, not the exact value.
    expect(zoneDecision?.vents[0]?.commanded_position_pct).toBeLessThan(100);
    expect(zoneDecision?.classification).toBe("unclassified_no_sensor");
  });
});

describe("runTick — shadow mode (dry run)", () => {
  it("computes real decisions but never calls the Flair client", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    ctx.globalDryRun = true;

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.dry_run).toBe(true);
    expect(decision.zones[0].vents[0]?.commanded_position_pct).toBeGreaterThan(
      0,
    );
    expect(client.getVentCommandHistory()).toHaveLength(0);
    expect(client.getSetpointCommandHistory()).toHaveLength(0);
  });
});

describe("runTick — manual disarm", () => {
  it("dispatches every smart vent to its idle baseline and suppresses the setpoint write", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({
      control_disarmed: true,
      live_air_handler_ids: ["ah-1"],
    });

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.control_disarmed).toBe(true);
    expect(client.getVentCommandHistory()[0]).toMatchObject({
      ventId: "vent-1",
      percentOpen: 100,
    }); // idle_baseline_position default 100
    expect(client.getSetpointCommandHistory()).toHaveLength(0);
  });
});

describe("runTick — genuine contention", () => {
  it("reduces the lower-priority zone and pushes a real setpoint tracking the worst-off zone", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 14,
        percentOpen: 50,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [
      makeZone({ id: "z1", flairRoomId: "room-1" }),
      makeZone({ id: "z2", flairRoomId: "room-2" }),
    ];
    // idle_baseline_position defaults to 100 in makeZone's config, which
    // (per the domain layer's own behavior) pins every demanding zone's
    // Step 1 output at 100 regardless of demand — give both zones room to
    // actually be reduced by lowering it.
    zones.forEach((z) => (z.config.idle_baseline_position = 0));
    const persisted = new Map<string, ZoneRuntimeState>();
    // A tiny blower rating forces contention between the two zones.
    const airHandler = makeAirHandler({
      blower_rated_flow_rate_lps: 30,
      blower_rated_flow_rate_is_estimate: false,
    });
    const ctx = makeCtx({ zone_priority_order: ["z1"] }); // z1 explicitly higher priority

    const decision = await runTick(
      airHandler,
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.contention).not.toBeNull();
    const z1 = decision.zones.find((z) => z.zone_id === "z1")!;
    const z2 = decision.zones.find((z) => z.zone_id === "z2")!;
    expect(z1.vents[0]!.commanded_position_pct!).toBeGreaterThanOrEqual(
      z2.vents[0]!.commanded_position_pct!,
    );

    // The driving zone (worst-off, both equally demanding here) still gets
    // a real setpoint pushed to Flair.
    expect(client.getSetpointCommandHistory().length).toBeGreaterThan(0);
  });
});

describe("runTick — reconciliation retry and degrade", () => {
  it("degrades a vent once reconcile attempts reach the configured max", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 10,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: {
          last_target_position: 80, // the vent never actually got there
          vents: [makeVentState("vent-1", { reconcile_attempts: 3 })], // already at the default max (3)
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    const deps = makeDeps(client, persisted, NOW);
    await deps.reconciliationQueue.enqueue("z1:vent-1", NOW); // due right now

    await runTick(makeAirHandler(), zones, ctx, deps);

    expect(
      persisted.get("z1")?.vents.find((v) => v.flair_vent_id === "vent-1")
        ?.degraded,
    ).toBe(true);
  });

  it("reconciles cleanly when the reported position now matches the target", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 80,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: {
          last_target_position: 80,
          vents: [
            makeVentState("vent-1", {
              reconcile_attempts: 1,
              degraded: true,
              degraded_since: "2024-01-01T00:00:00.000Z",
            }),
          ],
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    const deps = makeDeps(client, persisted, NOW);
    await deps.reconciliationQueue.enqueue("z1:vent-1", NOW);

    await runTick(makeAirHandler(), zones, ctx, deps);

    const ventAfter = persisted
      .get("z1")
      ?.vents.find((v) => v.flair_vent_id === "vent-1");
    expect(ventAfter?.reconcile_attempts).toBe(0);
    expect(ventAfter?.degraded).toBe(false);
  });
});

describe("runTick — periodic drift-check backstop", () => {
  function makeRuntimeState(
    ticksSinceDriftCheck: number,
  ): Parameters<TickDeps["airHandlerRuntimeStore"]["set"]>[1] {
    return {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: null,
      callStartedAtMs: null,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck,
    };
  }

  it("enqueues a reconciliation for a zone that drifted with no reconciliation pending, once the configured cadence is reached", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 40, // reports 40, but we last commanded it to 80
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: { last_target_position: 80 },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({
      drift_check_interval_ticks: 3,
      min_step_delta_pct: 15,
    });
    const deps = makeDeps(client, persisted, NOW);
    // One more tick reaches the configured interval of 3.
    await deps.airHandlerRuntimeStore.set("ah-1", makeRuntimeState(2));
    // Asserted via a spy, not the queue's post-tick state: this same zone
    // is also demanding and not yet dispatched, so the ordinary Steps
    // 12-13 dispatch this tick legitimately re-enqueues it too, at a
    // later due time (nowMs + actuation delay) that would otherwise
    // overwrite the drift check's own immediate-due entry in the queue —
    // both are correct, independent behavior, so the drift check's own
    // call is what's under test here, not the queue's final state.
    const enqueueSpy = vi.spyOn(deps.reconciliationQueue, "enqueue");

    await runTick(makeAirHandler(), zones, ctx, deps);

    expect(enqueueSpy).toHaveBeenCalledWith("z1:vent-1", NOW);
  });

  it("does not check yet if the configured interval hasn't been reached", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 40,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: { last_target_position: 80 },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ drift_check_interval_ticks: 10 });
    const deps = makeDeps(client, persisted, NOW);
    await deps.airHandlerRuntimeStore.set("ah-1", makeRuntimeState(0));
    const enqueueSpy = vi.spyOn(deps.reconciliationQueue, "enqueue");

    await runTick(makeAirHandler(), zones, ctx, deps);

    expect(enqueueSpy).not.toHaveBeenCalledWith("z1", NOW);
  });
});

describe("runTick — unknown call confidence", () => {
  it("holds every zone at its idle baseline rather than inferring state", async () => {
    const client = new FakeFlairClient();
    // No thermostat linked at all — deriveHvacState sees a null
    // operating-state and reports "unknown" confidence.
    client.setZones([
      {
        id: FLAIR_ZONE_ID,
        structureId: STRUCTURE_ID,
        name: "Upstairs",
        thermostatId: null,
      },
    ]);
    client.setRooms([
      {
        id: "room-1",
        zoneId: FLAIR_ZONE_ID,
        structureId: STRUCTURE_ID,
        name: "room-1",
        currentTemperatureC: 24,
        setpointC: null,
        active: true,
        hasVents: true,
        hasPucks: false,
        hasRemoteSensors: false,
      },
    ]);
    client.setVents([
      {
        id: "vent-1",
        roomId: "room-1",
        name: "vent-1",
        percentOpen: 50,
        inactive: false,
        voltage: null,
        currentRssi: null,
      },
    ]);
    client.setVentReading({
      ventId: "vent-1",
      percentOpen: 50,
      ductTemperatureC: 14,
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.call_confidence).toBe("unknown");
    expect(client.getVentCommandHistory()[0]).toMatchObject({
      ventId: "vent-1",
      percentOpen: 100,
    }); // idle_baseline_position default
  });
});

describe("runTick — no Flair zone linked", () => {
  it("returns a minimal decision without touching the Flair client at all", async () => {
    const client = new FakeFlairClient();
    const airHandler = { ...makeAirHandler(), flairZoneId: null };
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.zones).toEqual([]);
    expect(client.getVentCommandHistory()).toHaveLength(0);
  });
});

describe("runTick — equipment fault clearing", () => {
  it("clears the fault once the duct differential recovers past the dwell period", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      }, // healthy differential now
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 20 * 60000,
      equipmentFaultActive: true,
      // Dwell (default 5 min) already exceeded — should clear this tick.
      equipmentFaultClearDwellSinceMs: NOW - 10 * 60000,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.narrative).not.toMatch(/Emergency fail-safe/);
    const runtime = await deps.airHandlerRuntimeStore.get("ah-1");
    expect(runtime.equipmentFaultActive).toBe(false);
  });
});

describe("runTick — isolated duct airflow anomaly", () => {
  it("flags a demanding zone whose duct fails the differential while a sibling passes", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
      }, // passes
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 29,
        percentOpen: 80,
      }, // fails, demanding
    ]);
    const zones = [
      makeZone({ id: "z1", flairRoomId: "room-1" }),
      makeZone({ id: "z2", flairRoomId: "room-2" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    // Not enough for the whole-system fail-safe grace period to matter —
    // z1 passing keeps this an isolated anomaly, not a fault.
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.narrative).not.toMatch(/Emergency fail-safe/);
  });
});

describe("runTick — multi-vent zones", () => {
  it("gangs both of a zone's vents to the same computed target position", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        flairVentIds: ["vent-1", "vent-2"],
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const decision = await runTick(
      makeAirHandler(),
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    const history = client.getVentCommandHistory();
    expect(history.map((c) => c.ventId).sort()).toEqual(["vent-1", "vent-2"]);
    const [cmd1, cmd2] = history;
    expect(cmd1.percentOpen).toBe(cmd2.percentOpen);
    const zoneDecision = decision.zones.find((z) => z.zone_id === "z1")!;
    expect(zoneDecision.vents).toHaveLength(2);
    expect(zoneDecision.vents[0].commanded_position_pct).toBe(
      zoneDecision.vents[1].commanded_position_pct,
    );
  });

  it("one vent degrading doesn't punish its sibling — zone-level rollup is 'any degraded'", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 10,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 24,
        ductC: 14,
        percentOpen: 80,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        flairVentIds: ["vent-1", "vent-2"],
        state: {
          last_target_position: 80,
          vents: [
            makeVentState("vent-1", { reconcile_attempts: 3 }), // already at max
            makeVentState("vent-2", { last_reported_position: 80 }), // already there — healthy
          ],
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    const deps = makeDeps(client, persisted, NOW);
    await deps.reconciliationQueue.enqueue("z1:vent-1", NOW);

    await runTick(makeAirHandler(), zones, ctx, deps);

    const finalVents = persisted.get("z1")?.vents ?? [];
    expect(finalVents.find((v) => v.flair_vent_id === "vent-1")?.degraded).toBe(
      true,
    );
    expect(finalVents.find((v) => v.flair_vent_id === "vent-2")?.degraded).toBe(
      false,
    );
  });

  it("an isolated duct anomaly on one vent is not cleared by a healthy sibling processed in the same tick — the compound-key regression test", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 29,
        percentOpen: 80,
      }, // fails the differential
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
      }, // passes
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        flairVentIds: ["vent-1", "vent-2"],
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);

    await runTick(makeAirHandler(), zones, makeCtx(), deps);

    const failingTracking = await deps.zoneDemandTrackingStore.get("z1:vent-1");
    const passingTracking = await deps.zoneDemandTrackingStore.get("z1:vent-2");
    expect(failingTracking.ductAnomalySinceMs).not.toBeNull();
    expect(passingTracking.ductAnomalySinceMs).toBeNull();
  });
});

describe("runTick — Away Mode (partial house)", () => {
  it("applies the away setpoint/tolerance only to the native-away zone, resolving the other zone normally in the same tick", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      // Same room temperature for both — any difference in outcome is
      // purely due to away targeting, not a different starting point.
      {
        roomId: "room-away",
        ventId: "vent-away",
        tempC: 25,
        ductC: 14,
        percentOpen: 50,
      },
      {
        roomId: "room-home",
        ventId: "vent-home",
        tempC: 25,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    // Ecobee's own Home/Away state stays "Home" — this must be the native
    // per-zone selection doing the work, not the Ecobee-sourced (whole-
    // handler) source, per the plan's partial-house requirement.
    const zones = [
      makeZone({ id: "z-away", flairRoomId: "room-away" }),
      makeZone({ id: "z-home", flairRoomId: "room-home" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ away_native_zone_ids: ["z-away"] });

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    // Away setpoint (27.78°C default) + wide tolerance (±2.78°C) puts a
    // 25°C room comfortably satisfied — closed to its floor once also
    // unoccupied during an active call (see "Occupancy"). The fallback
    // setpoint (23.89°C, unset/tight tolerance) leaves the same 25°C room
    // still genuinely demanding.
    expect(
      decision.zones.find((z) => z.zone_id === "z-away")?.classification,
    ).toBe("satisfied");
    expect(
      decision.zones.find((z) => z.zone_id === "z-away")?.vents[0]
        ?.commanded_position_pct,
    ).toBe(0);
    expect(
      decision.zones.find((z) => z.zone_id === "z-home")?.classification,
    ).toBe("demanding");
    expect(
      decision.zones.find((z) => z.zone_id === "z-home")?.vents[0]
        ?.commanded_position_pct,
    ).toBeGreaterThan(0);
  });
});

// Regression coverage for a real, confirmed bug found live: awayTargets and
// fallback both used to compare the raw hvac.state against a literal
// "COOLING_CALL" directly, which is always false during FAN_ONLY/IDLE
// regardless of which direction the system actually runs — silently
// resolving the *heat* setpoint on every idle/fan tick for this
// cooling-only household. Fixed via the shared effectiveCallState.
describe("runTick — away/fallback targets resolve the correct (cooling) direction during FAN_ONLY", () => {
  it("resolves the away zone as satisfied against the away *cool* setpoint, not the heat one", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-away",
          ventId: "vent-away",
          tempC: 25,
          ductC: 14,
          percentOpen: 50,
        },
      ],
      "fan", // FAN_ONLY — the buggy code path only misfired here, never during COOLING_CALL
    );
    const zones = [makeZone({ id: "z-away", flairRoomId: "room-away" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({ away_native_zone_ids: ["z-away"] });

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.hvac_state).toBe("FAN_ONLY");
    // Correct (cool) target: away_setpoint_cool 27.78°C ± away_tolerance
    // 2.78°C comfortably covers a 25°C room -> satisfied. The pre-fix bug
    // resolved away_setpoint_heat (15.56°C) instead, which a 25°C room is
    // nowhere near -> would have read "demanding".
    expect(
      decision.zones.find((z) => z.zone_id === "z-away")?.classification,
    ).toBe("satisfied");
  });

  it("resolves an unscheduled zone's fallback target against the fallback *cool* setpoint, not the heat one", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-1",
          ventId: "vent-1",
          // Barely above the correct fallback_setpoint_cool (23.89°C),
          // within the 0.56°C minimum-tolerance floor -> satisfied. The
          // pre-fix bug would have resolved fallback_setpoint_heat
          // (21.11°C) instead, which this same reading sits 2.79°C past
          // -> would have read "demanding".
          tempC: 23.9,
          ductC: 14,
          percentOpen: 50,
        },
      ],
      "fan",
    );
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.hvac_state).toBe("FAN_ONLY");
    expect(decision.zones.find((z) => z.zone_id === "z1")?.classification).toBe(
      "satisfied",
    );
  });
});

// Regression coverage for a second real, confirmed bug in the same family:
// drivingCandidates' deviation formula had the identical raw-hvac.state
// comparison. Because every candidate's deviation flips sign uniformly
// during FAN_ONLY/IDLE, the bug didn't just get the magnitude wrong — among
// zones already correctly flagged demanding, it inverted the worst-off
// ranking (a room barely over its setpoint looked "worse" than one
// spiking hard), so the setpoint push could get calibrated to the wrong
// zone's offset during every idle/fan gap.
describe("runTick — driving-zone selection ranks the genuinely worst-off zone during FAN_ONLY", () => {
  it("tracks the sharply spiking zone, not the one barely over its target", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-barely",
          ventId: "vent-barely",
          // ~0.6°C past the fallback cool setpoint (23.89°C) + the 0.56°C
          // minimum-tolerance floor -> hairline demanding.
          tempC: 24.5,
          ductC: 14,
          percentOpen: 50,
        },
        {
          roomId: "room-spike",
          ventId: "vent-spike",
          // Way past target -> the genuinely worst-off zone.
          tempC: 30,
          ductC: 14,
          percentOpen: 50,
        },
      ],
      "fan",
    );
    const zones = [
      makeZone({ id: "z-barely", flairRoomId: "room-barely" }),
      makeZone({ id: "z-spike", flairRoomId: "room-spike" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.hvac_state).toBe("FAN_ONLY");
    expect(
      decision.zones.find((z) => z.zone_id === "z-barely")?.classification,
    ).toBe("demanding");
    expect(
      decision.zones.find((z) => z.zone_id === "z-spike")?.classification,
    ).toBe("demanding");
    // The pre-fix bug's inverted ranking would have tracked "z-barely"
    // instead (its wrongly-signed deviation, -3.39, beats z-spike's -8.89).
    expect(decision.driving_zone).toEqual({
      zone_id: "z-spike",
      reason: "dynamic_worst_off",
    });
  });
});

describe("runTick — schedule-driven per-room settings", () => {
  it("applies a governing event's per-zone setpoint, tolerance, and Sleep Mode override", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Always On",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21,
                heat_setpoint: 19,
                comfort_tolerance: 0.5,
                assume_occupied: true,
              },
            ],
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.zones[0].occupied).toBe(true);
  });

  it("a governing event's own driving_zone_overrides pins the tracked zone, overriding the global default", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      // z1's own deviation (1°C) is smaller than z2's (4°C) — dynamic
      // worst-off selection would pick z2 absent any override.
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 22,
        ductC: 14,
        percentOpen: 50,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 25,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [
      makeZone({ id: "z1", flairRoomId: "room-1" }),
      makeZone({ id: "z2", flairRoomId: "room-2" }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Always On",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: false,
              },
              {
                zone_id: "z2",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
            // ah-1 is this fixture's air handler id (makeAirHandler()) —
            // pins tracking to z1 despite z2 being the real worst-off zone.
            driving_zone_overrides: { "ah-1": "z1" },
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    expect(decision.driving_zone).toEqual({
      zone_id: "z1",
      reason: "explicit_override",
    });
  });
});

describe("runTick — quiet actuation during Sleep Mode", () => {
  it("suppresses a dispatch a non-sleep zone would send, for an identical deviation", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      // Large deviation (30 vs a 21 setpoint) so Step 1's desired position
      // clamps to 100% regardless of any modifier boost — isolating the
      // dispatch-threshold behavior under test from Step 1's own math.
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 14,
        percentOpen: 40,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 40,
      },
    ]);
    // Ramp origin 50 + a single 10%-max step (default modulation settings)
    // ramps deterministically to 60 this tick, regardless of Step 1/3
    // internals — then last_reported_position 40 gives an identical 20%
    // delta for both zones: below the sleep-mode threshold (30), at/above
    // the normal one (15).
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: {
          last_target_position: 50,
          vents: [makeVentState("vent-1", { last_reported_position: 40 })],
        },
      }),
      makeZone({
        id: "z2",
        flairRoomId: "room-2",
        state: {
          last_target_position: 50,
          vents: [makeVentState("vent-2", { last_reported_position: 40 })],
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({
      min_step_delta_pct: 15,
      sleep_mode_min_step_delta_pct: 30,
    });
    ctx.schedules = [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Night",
        config: { enabled: true, default_inactive: false },
        events: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2024-01-01T00:00:00.000Z",
            modified_at: "2024-01-01T00:00:00.000Z",
            mode: "active",
            start_time: "00:00",
            end_time: "23:59",
            days_of_week: 0b1111111,
            zone_settings: [
              {
                zone_id: "z1",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: true,
              },
              {
                zone_id: "z2",
                cool_setpoint: 21,
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ];

    const decision = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    const dispatchedVentIds = client
      .getVentCommandHistory()
      .map((c) => c.ventId);
    expect(dispatchedVentIds).not.toContain("vent-1");
    expect(dispatchedVentIds).toContain("vent-2");

    // The tick decision record surfaces *why* z1 held (Sleep Mode's wider
    // 30% threshold, with only a 20% accumulated delta) vs. why z2 sent
    // (the normal 15% threshold, cleared by the same 20% delta) — this is
    // the UI-facing distinction "is commanded truly the command being
    // sent?" resolves.
    const z1Vent = decision.zones.find((z) => z.zone_id === "z1")?.vents[0];
    const z2Vent = decision.zones.find((z) => z.zone_id === "z2")?.vents[0];
    expect(z1Vent?.dispatch_decision).toBe("suppressed_step_delta");
    expect(z1Vent?.step_delta_pct).toBe(20);
    expect(z1Vent?.min_step_delta_pct).toBe(30);
    expect(z2Vent?.dispatch_decision).toBe("dispatched");
    expect(z2Vent?.step_delta_pct).toBe(20);
    expect(z2Vent?.min_step_delta_pct).toBe(15);
  });
});

describe("runTick — live occupancy sensing", () => {
  it("reflects a room's Ecobee SmartSensor occupied reading with no schedule/Sleep Mode override involved", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    client.setRemoteSensors([
      {
        id: "sensor-1",
        roomId: "room-1",
        isTstat: false,
        sensorType: "ecobee_ecobee3_remote_sensor",
        name: "Den",
      },
    ]);
    client.setRemoteSensorReading({
      remoteSensorId: "sensor-1",
      occupied: true,
      temperatureC: 24,
      humidity: 40,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const zone = makeZone({ id: "z1", flairRoomId: "room-1" });
    zone.config.has_occupancy_sensor = true;
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();

    // Tick 1 starts the stabilization dwell (default 2 min); tick 2, past
    // the dwell, is where the flip to occupied actually registers.
    await runTick(
      makeAirHandler(),
      [zone],
      ctx,
      makeDeps(client, persisted, NOW),
    );
    const zoneTick2 = { ...zone, state: persisted.get("z1")! };
    const decision2 = await runTick(
      makeAirHandler(),
      [zoneTick2],
      ctx,
      makeDeps(client, persisted, NOW + 3 * 60000),
    );

    expect(decision2.zones[0].occupied).toBe(true);
    expect(persisted.get("z1")?.occupied).toBe(true);
  });

  it("does not flip on a single-tick flicker (stabilization dwell) — mirrors spike detection's hysteresis", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    client.setRemoteSensors([
      {
        id: "sensor-1",
        roomId: "room-1",
        isTstat: false,
        sensorType: "ecobee_ecobee3_remote_sensor",
        name: "Den",
      },
    ]);
    client.setRemoteSensorReading({
      remoteSensorId: "sensor-1",
      occupied: true,
      temperatureC: 24,
      humidity: 40,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const zone = makeZone({ id: "z1", flairRoomId: "room-1" });
    zone.config.has_occupancy_sensor = true;
    const persisted = new Map<string, ZoneRuntimeState>();

    // occupancy_stabilization_minutes defaults to 2 — a single tick isn't
    // enough for a flip from the previously-unoccupied state to register.
    const decision = await runTick(
      makeAirHandler(),
      [zone],
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.zones[0].occupied).toBe(false);
    expect(persisted.get("z1")?.occupancy_pending_flip_since).not.toBeNull();
  });
});
