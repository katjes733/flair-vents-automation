import { describe, it, expect, vi } from "vitest";
import { logSpy } from "../../setup";
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
import { FakeHomeKitClient } from "../../helpers/fakeHomeKitClient";

// tickDecision.ts's cache is Redis-backed (see its own comment on why a
// worker-process/API-server split made an in-memory Map wrong) — runTick()
// calls it unconditionally on every return path via finalize(), so every
// test in this file needs this mocked, not just ones that care about the
// cached record's own content.
vi.mock("~/server/util/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

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
  // "Ecobee SmartSensor Reading via HomeKit" — the Serial Number this
  // zone reads its live sensor data from when its air handler is on
  // setpoint_delivery_mode "homekit". Left unset (null) by every existing
  // call site — zero behavior change for tests that never touch this.
  homekitSensorSerial?: string;
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
      ...(params.homekitSensorSerial
        ? { homekit_sensor_serial: params.homekitSensorSerial }
        : {}),
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
      // Fresh relative to NOW, not a fixed 2024-01-01 date — the duct
      // fault/anomaly checks now actually enforce staleness (see
      // isDuctReadingStale in tick.ts), so a reading fixed at midnight
      // while every test tick runs at NOW (12:00 the same day) or a few
      // minutes after would otherwise always read as stale.
      createdAt: new Date(NOW).toISOString(),
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

  // Regression test for a real, confirmed wording problem: a real
  // production alert read "worst deviation 0.00°C, vs 0.00°C at call
  // start" — technically accurate, but indistinguishable from "everything
  // is fine" when the real situation was "zero zones this app tracks are
  // demanding at all, yet the equipment kept calling anyway." The two
  // cases need different wording, since only one of them names an actual
  // zone to look at.
  it("explains that no tracked zone is demanding at all, rather than reporting a bare 0.00°C, when there's truly nothing demanding", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      // Comfortably satisfied against the fallback setpoint — no zone is
      // demanding, ever, for the whole test.
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
    const deps = makeDeps(client, persisted, NOW);
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 80 * 60000,
      worstDeviationAtCallStartC: 0,
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
    const [text] = alerting.getSentTexts();
    expect(text).toMatch(/no zone this app tracks has been actively demanding/);
    expect(text).not.toMatch(/0\.00°C/);
  });

  it("names the actual worst-off zone when a real, unimproving deviation exists", async () => {
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
                cool_setpoint: 21,
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
    const [text] = alerting.getSentTexts();
    expect(text).toMatch(/worst-off zone, "z1"/);
    expect(text).toMatch(/3\.00°C at call start/);
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
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        // A vent's duct reading is only "usable" for the fault check if
        // it was actually open enough recently — see minVentOpenPct's own
        // comment. Seeded open here since this test's own intent is "the
        // vent IS open, but duct temp still doesn't show a differential
        // — a real fault," not "the vent happens to be closed."
        state: {
          vents: [makeVentState("vent-1", { last_reported_position: 100 })],
        },
      }),
    ];
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

  // Regression test for a real, confirmed bug found live in production:
  // the trigger log always reported the configured threshold constant
  // (equipment_fault_duct_delta_threshold_c) as `duct_delta_c`, never the
  // actual measured differential — making two real production triggers
  // impossible to diagnose after the fact. Fixture's real delta (24-23=1)
  // must appear, not the default threshold (5.56).
  it("logs the real measured duct differential on trigger, not the configured threshold", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 23,
        percentOpen: 20,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: {
          vents: [makeVentState("vent-1", { last_reported_position: 100 })],
        },
      }),
    ];
    const deps = makeDeps(client, new Map(), NOW);
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

    await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(logSpy("error")).toHaveBeenCalledWith(
      expect.objectContaining({
        fault_signal: "duct_temperature_differential",
        duct_delta_c: 1,
        duct_deltas_c: [
          expect.objectContaining({
            zone_id: "z1",
            vent_id: "vent-1",
            delta_c: 1,
          }),
        ],
      }),
      "Emergency fail-safe triggered",
    );
  });

  // Regression test for a real, confirmed bug found live via telemetry
  // review: a stale duct reading used to be treated as live data (the
  // exclusion filter always saw ductReadingStale: false, unconditionally),
  // so an upstream Flair data-refresh gap — freezing the duct reading from
  // before a call finished cooling, which reads *warm* once stale — could
  // trip a real Emergency Fail-Safe with no genuine equipment problem at
  // all. Confirmed live: two fail-safe triggers correlated exactly with
  // every smart-vent zone's room reading also going stale in the same
  // tick. A stale duct reading must be excluded ("dormant"), not treated
  // as a failing one.
  it("does not trigger the fail-safe on a stale duct reading that would otherwise look like a failure", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 23, // would fail the differential if treated as live
        percentOpen: 20,
      },
    ]);
    // Override the vent reading's own timestamp to be old enough to cross
    // the default 25-minute staleness threshold as of `NOW`.
    client.setVentReading({
      ventId: "vent-1",
      percentOpen: 20,
      ductTemperatureC: 23,
      createdAt: new Date(NOW - 30 * 60000).toISOString(),
    });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: null,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 30 * 60000,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.equipment_fault_active).toBe(false);
    expect(decision.narrative).not.toMatch(/Emergency fail-safe/);
  });

  // Regression test for a real, confirmed live false-positive: a call was
  // sustained entirely by a manual-vent zone (no duct sensor at all),
  // while the only smart vent on the handler happened to be
  // satisfied-and-near-closed at the exact moment the grace period
  // elapsed — its own duct reading, warmed toward room-ambient by the
  // lack of real airflow through it, was still counted as "usable,"
  // tripping a fault with no genuine equipment problem. A near-closed
  // vent's duct reading must be excluded ("dormant"), the same way a
  // stale one already is above.
  it("does not trigger the fail-safe on a near-closed smart vent's own room-warmed duct reading", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 24,
        ductC: 23, // would fail the differential if this near-closed vent were trusted
        percentOpen: 10,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        state: {
          vents: [makeVentState("vent-1", { last_reported_position: 10 })],
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
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

    expect(decision.equipment_fault_active).toBe(false);
    expect(decision.narrative).not.toMatch(/Emergency fail-safe/);
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

  // Regression test for a real, confirmed bug found live via a real
  // production alert: once a stale reading resumes changing, the zone
  // used to sit in classifyWithStabilization's dwell for a further
  // classification_stabilization_minutes before actually being treated as
  // demanding again — contradicting this safeguard's own documented
  // "resumes immediately" contract. Traced to a real Martin Office alert
  // where the sensor visibly resumed reporting at one tick but the zone
  // wasn't reclassified as demanding until 3 minutes later.
  it("resumes normal classification the very next tick once a stale reading starts changing again — no extra dwell", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx({
      stale_threshold_minutes: 1,
      classification_stabilization_minutes: 3,
    });

    // Tick 1: establishes a baseline reading.
    await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );

    // Tick 2, two minutes later, same unchanged reading — now stale and
    // excluded (mirrors the test above).
    const zonesTick2 = [
      makeZone({ id: "z1", flairRoomId: "room-1", state: persisted.get("z1") }),
    ];
    const decision2 = await runTick(
      makeAirHandler(),
      zonesTick2,
      ctx,
      makeDeps(client, persisted, NOW + 2 * 60000),
    );
    expect(
      decision2.zones.find((z) => z.zone_id === "z1")?.classification,
    ).toBe("unclassified_no_sensor");

    // Tick 3: the reading resumes with a genuinely new value. The fix
    // under test — this must show "demanding" on THIS tick, not 3 minutes
    // (a full stabilization dwell) later.
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 27,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zonesTick3 = [
      makeZone({ id: "z1", flairRoomId: "room-1", state: persisted.get("z1") }),
    ];
    const decision3 = await runTick(
      makeAirHandler(),
      zonesTick3,
      ctx,
      makeDeps(client, persisted, NOW + 3 * 60000),
    );
    expect(
      decision3.zones.find((z) => z.zone_id === "z1")?.classification,
    ).toBe("demanding");
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

  // Regression test for a real, confirmed bug found live: a shadowed
  // zone's persisted last_reported_position (this app's own record of
  // "the last thing we told this vent," read back as lastDispatchedPosition
  // — see dispatcher.ts) used to freeze in dry_run mode instead of
  // advancing like every other piece of ramp state, contradicting shadow
  // mode's own stated guarantee ("dispatch state advances exactly as it
  // would live"). With it frozen, a zone whose target had drifted far
  // enough from the frozen baseline to cross the dispatch threshold once
  // kept recomputing that identical "would dispatch" answer every
  // subsequent tick forever, even once its target stopped changing at
  // all — confirmed live via a screenshot showing a zone stuck showing
  // "sent" indefinitely while sitting at a stable position.
  it("advances a shadowed zone's dispatch state across ticks, settling into 'no change needed' rather than re-dispatching forever", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 15, // well below the fallback cool setpoint -> satisfied, closes to floor
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    ctx.globalDryRun = true;

    const decision1 = await runTick(
      makeAirHandler(),
      zones,
      ctx,
      makeDeps(client, persisted, NOW),
    );
    // First tick ever for this zone — no prior dispatched position on
    // record, so it unconditionally dispatches once.
    expect(decision1.zones[0]?.vents[0]?.dispatch_decision).toBe("dispatched");
    const settledPosition =
      decision1.zones[0]?.vents[0]?.commanded_position_pct;

    // Tick 2, same reading, same target — reload the zone from what tick 1
    // actually persisted (mirroring every other multi-tick test's pattern).
    const zonesTick2 = [
      makeZone({ id: "z1", flairRoomId: "room-1", state: persisted.get("z1") }),
    ];
    const decision2 = await runTick(
      makeAirHandler(),
      zonesTick2,
      ctx,
      makeDeps(client, persisted, NOW + 60000),
    );

    expect(decision2.zones[0]?.vents[0]?.commanded_position_pct).toBe(
      settledPosition,
    );
    // The fix under test: dispatch state advanced from tick 1, so tick 2
    // correctly sees zero accumulated delta — not another "dispatched".
    expect(decision2.zones[0]?.vents[0]?.dispatch_decision).toBe(
      "suppressed_step_delta",
    );
    expect(decision2.zones[0]?.vents[0]?.step_delta_pct).toBe(0);
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

  it("logs the real room-vs-duct delta on a detected anomaly, not a hardcoded null", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 29,
        percentOpen: 80,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
      },
    ]);
    const zones = [
      makeZone({
        id: "z1",
        flairRoomId: "room-1",
        flairVentIds: ["vent-1", "vent-2"],
      }),
    ];
    const deps = makeDeps(client, new Map(), NOW);

    await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(logSpy("warn")).toHaveBeenCalledWith(
      expect.objectContaining({
        zone_id: "z1",
        vent_id: "vent-1",
        duct_delta_c: 1,
      }),
      "Duct airflow anomaly detected",
    );
  });

  it("logs 'Duct airflow anomaly cleared' once a previously-anomalous vent stops being anomalous", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 29,
        percentOpen: 80,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
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
    const deps = makeDeps(client, persisted, NOW);
    await runTick(makeAirHandler(), zones, makeCtx(), deps);
    expect(logSpy("info")).not.toHaveBeenCalledWith(
      expect.anything(),
      "Duct airflow anomaly cleared",
    );

    // Same vent, still failing the differential (delta 1°C, still below
    // the threshold), but the zone is now satisfied (23°C is at/under the
    // 23.89°C fallback cool setpoint) — no longer "anomalous" per
    // detectDuctAirflowAnomaly's own demanding gate, so the tracked
    // episode should end here.
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 23,
        ductC: 22,
        percentOpen: 80,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 23,
        ductC: 14,
        percentOpen: 80,
      },
    ]);
    await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(logSpy("info")).toHaveBeenCalledWith(
      expect.objectContaining({ zone_id: "z1", vent_id: "vent-1" }),
      "Duct airflow anomaly cleared",
    );
  });

  it("clears a tracked anomaly when the vent recovers by jumping straight to passing the differential (not just becoming non-demanding) — the fix for the never-in-`anomalies`-again gap", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 29,
        percentOpen: 80,
      }, // fails the differential — anomalous
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
    const trackedWhileAnomalous =
      await deps.zoneDemandTrackingStore.get("z1:vent-1");
    expect(trackedWhileAnomalous.ductAnomalySinceMs).not.toBeNull();

    // Same zone, still demanding (30°C, unchanged) — but vent-1's own duct
    // now shows the expected differential too (the duct physically caught
    // up), so it drops out of detectDuctAirflowAnomaly's `failing` list
    // entirely rather than reappearing with anomalous: false.
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
      },
      {
        roomId: "room-2",
        ventId: "vent-2",
        tempC: 30,
        ductC: 14,
        percentOpen: 80,
      },
    ]);
    await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(logSpy("info")).toHaveBeenCalledWith(
      expect.objectContaining({ zone_id: "z1", vent_id: "vent-1" }),
      "Duct airflow anomaly cleared",
    );
    const trackedAfterRecovery =
      await deps.zoneDemandTrackingStore.get("z1:vent-1");
    expect(trackedAfterRecovery.ductAnomalySinceMs).toBeNull();
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

  it("uses this air handler's own away-override setpoint/tolerance instead of the global System Parameters value when set", async () => {
    const client = new FakeFlairClient();
    // 25°C is comfortably within the global away band (27.78°C ± 2.78°C)
    // but NOT within a much tighter, colder per-handler override (22°C ±
    // 0.5°C) — so which one actually governs is directly observable via
    // the resulting classification, not just an internal field.
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 25,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const ctx = makeCtx({ away_native_zone_ids: ["z1"] });
    const airHandler = makeAirHandler({
      away_setpoint_cool_override: 22,
      away_tolerance_override: 0.5,
    });

    const decision = await runTick(
      airHandler,
      zones,
      ctx,
      makeDeps(client, new Map(), NOW),
    );

    expect(decision.zones.find((z) => z.zone_id === "z1")?.classification).toBe(
      "demanding",
    );
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

  // Regression test for a real, confirmed live issue: two bedrooms sat
  // fully open, unconditionally protected, for 20-30 minutes with nobody
  // in them while a different room was demanding — traced to Ecobee's own
  // SmartSensors reporting a room "occupied" for a documented 30 minutes
  // after the last real motion, not a live fact. A live occupied signal
  // sustained past occupancy_trust_window_minutes must stop protecting a
  // satisfied zone from closing during an active call, even though the
  // *displayed* `occupied` field stays true (matching what Ecobee/Flair
  // themselves still report).
  it("stops trusting a live-occupied signal once sustained past the trust window, letting a satisfied zone close", async () => {
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
    client.setRemoteSensors([
      {
        id: "sensor-bedroom",
        roomId: "room-bedroom",
        isTstat: false,
        sensorType: "ecobee_ecobee3_remote_sensor",
        name: "Bedroom",
      },
    ]);
    client.setRemoteSensorReading({
      remoteSensorId: "sensor-bedroom",
      occupied: true,
      temperatureC: 15,
      humidity: 40,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const bedroom = makeZone({
      id: "z-bedroom",
      flairRoomId: "room-bedroom",
      state: {
        occupied: true,
        // Already occupied for 31 minutes as of this tick — past the
        // default 30-minute trust window.
        occupied_since: new Date(NOW - 31 * 60000).toISOString(),
      },
    });
    bedroom.config.has_occupancy_sensor = true;
    const office = makeZone({ id: "z-office", flairRoomId: "room-office" });

    const decision = await runTick(
      makeAirHandler(),
      [bedroom, office],
      makeCtx(),
      makeDeps(client, new Map(), NOW),
    );

    expect(decision.hvac_state).toBe("COOLING_CALL");
    const bedroomDecision = decision.zones.find(
      (z) => z.zone_id === "z-bedroom",
    );
    expect(bedroomDecision?.classification).toBe("satisfied");
    // Still reported as occupied — the dashboard must keep agreeing with
    // what Ecobee/Flair themselves report, even though it's no longer
    // trusted for position math.
    expect(bedroomDecision?.occupied).toBe(true);
    expect(bedroomDecision?.vents[0]?.commanded_position_pct).toBeLessThan(50);
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

describe("runTick — HomeKit setpoint delivery", () => {
  function makeHomeKitDeps(
    client: FakeFlairClient,
    homeKitClient: FakeHomeKitClient | null,
    persisted: Map<string, ZoneRuntimeState>,
    nowMs: number,
  ): TickDeps {
    return {
      client,
      getHomeKitClient: async () => homeKitClient,
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

  it("dispatches via setTargetTemperature when mode is Cool, and never touches the mode itself", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({ targetMode: 2, currentTempC: 24 });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, homeKitClient, persisted, NOW),
    );

    expect(decision.setpoint_push?.delivery_mode).toBe("homekit");
    expect(decision.setpoint_push?.homekit_paired).toBe(true);
    expect(decision.setpoint_push?.homekit_write_kind).toBe("target");
    expect(decision.setpoint_push?.homekit_error).toBeNull();
    expect(homeKitClient.writeHistory).toHaveLength(1);
    expect(homeKitClient.writeHistory[0].kind).toBe("target");
    // The FlairClient's own setpoint path must never fire for a handler
    // in "homekit" delivery mode.
    expect(client.getSetpointCommandHistory()).toHaveLength(0);
  });

  it("writes only the cooling threshold when mode is Auto and the call is cooling — never both, never the mode", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({ targetMode: 3, currentTempC: 24 });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, homeKitClient, persisted, NOW),
    );

    expect(decision.setpoint_push?.homekit_write_kind).toBe("threshold");
    expect(homeKitClient.writeHistory).toHaveLength(1);
    expect(homeKitClient.writeHistory[0].kind).toBe("threshold-cool");
  });

  it("skips writing entirely when mode is Off, without erroring", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({ targetMode: 0, currentTempC: 24 });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, homeKitClient, persisted, NOW),
    );

    expect(decision.setpoint_push?.homekit_write_kind).toBe("skip");
    expect(homeKitClient.writeHistory).toHaveLength(0);
  });

  it("a thrown HomeKit error is caught, logged on the decision record, and never aborts the tick", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({ targetMode: 2, currentTempC: 24 });
    homeKitClient.forceError(new Error("accessory unreachable"));
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, homeKitClient, persisted, NOW),
    );

    // The tick still completed and produced a real decision record —
    // this is the actual regression this fix guards against: a pre-
    // existing gap meant an uncaught throw here aborted the rest of
    // runTick, including finalize(), so no decision was ever cached.
    expect(decision).toBeDefined();
    expect(decision.setpoint_push?.homekit_error).toContain(
      "accessory unreachable",
    );
    expect(homeKitClient.writeHistory).toHaveLength(0);
  });

  it("a missing HomeKit pairing (getHomeKitClient resolves null) is reported, not thrown", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, null, persisted, NOW),
    );

    expect(decision.setpoint_push?.homekit_paired).toBe(false);
    expect(decision.setpoint_push?.homekit_error).toContain(
      "No HomeKit pairing available",
    );
  });

  it("the existing Flair delivery path is unaffected when setpoint_delivery_mode is left at its default", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      makeAirHandler(), // no setpoint_delivery_mode override — defaults to "flair"
      zones,
      makeCtx(),
      makeDeps(client, persisted, NOW),
    );

    expect(decision.setpoint_push?.delivery_mode).toBe("flair");
    expect(decision.setpoint_push?.homekit_paired).toBeNull();
    expect(client.getSetpointCommandHistory().length).toBeGreaterThan(0);
  });

  // Regression test: a hold cleared directly on the thermostat/Ecobee app
  // has no reason to be reflected in Flair's own relayed
  // thermostat-states.target-temperature-c until Flair's next cloud sync,
  // which can lag well behind reality (confirmed live this session) — the
  // displayed "currently held" setpoint must prefer a live HomeKit read
  // over that stale Flair value whenever one is available.
  it("prefers the live HomeKit-read target over Flair's own (possibly stale) relayed setpoint", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 26,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    // Flair's own snapshot still reports an old held value (75.2°F ≈
    // 24°C) even though the real thermostat has since had its hold
    // cleared and now reports something else entirely.
    client.setThermostatState({
      thermostatId: "therm-1",
      operatingState: "cool",
      mode: "cool",
      ambientTemperatureC: 22,
      targetTemperatureC: 24,
      homeAway: "Home",
      fanState: null,
      online: true,
      written: false,
      writtenConfirmed: false,
      writtenFailures: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({
      targetMode: 2,
      currentTempC: 26,
      targetTemperatureC: 21,
    });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();

    const decision = await runTick(
      airHandler,
      zones,
      makeCtx(),
      makeHomeKitDeps(client, homeKitClient, persisted, NOW),
    );

    expect(decision.setpoint_push?.thermostat_current_setpoint).toBeCloseTo(
      21,
      5,
    );
  });

  describe("thermostat_current_setpoint in Auto mode — a real, confirmed bug: TargetTemperature is never actually null in Auto, it's just stale", () => {
    it("falls through to the cooling threshold, not Flair's own relayed value, when the effective call is cooling", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 26,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      // Flair's own relayed value — must NOT win once a real HomeKit
      // threshold is available, even though targetTemperatureC is null.
      client.setThermostatState({
        thermostatId: "therm-1",
        operatingState: "cool",
        mode: "cool",
        ambientTemperatureC: 22,
        targetTemperatureC: 24,
        homeAway: "Home",
        fanState: null,
        online: true,
        written: false,
        writtenConfirmed: false,
        writtenFailures: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      });
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        targetMode: 3,
        targetTemperatureC: null,
        coolThresholdC: 22,
        heatThresholdC: 18.9,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.setpoint_push?.thermostat_current_setpoint).toBeCloseTo(
        22,
        5,
      );
    });

    it("falls back to Flair's own relayed value only when HomeKit has nothing for either threshold", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 26,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      client.setThermostatState({
        thermostatId: "therm-1",
        operatingState: "cool",
        mode: "cool",
        ambientTemperatureC: 22,
        targetTemperatureC: 24,
        homeAway: "Home",
        fanState: null,
        online: true,
        written: false,
        writtenConfirmed: false,
        writtenFailures: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      });
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        targetMode: 3,
        targetTemperatureC: null,
        coolThresholdC: null,
        heatThresholdC: null,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.setpoint_push?.thermostat_current_setpoint).toBeCloseTo(
        24,
        5,
      );
    });

    it("exposes the real two-sided hold (both thresholds) whenever both are genuinely available", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 26,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        targetMode: 3,
        targetTemperatureC: null,
        heatThresholdC: 18.9,
        coolThresholdC: 22.2,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.setpoint_push?.thermostat_heat_threshold).toBeCloseTo(
        18.9,
        5,
      );
      expect(decision.setpoint_push?.thermostat_cool_threshold).toBeCloseTo(
        22.2,
        5,
      );
    });

    it("leaves both threshold fields null outside Auto mode, or when only one side is available", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 26,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        targetMode: 2,
        targetTemperatureC: 21,
        heatThresholdC: null,
        coolThresholdC: null,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.setpoint_push?.thermostat_heat_threshold).toBeNull();
      expect(decision.setpoint_push?.thermostat_cool_threshold).toBeNull();
    });
  });

  describe("HVAC state via HomeKit — a real, confirmed incident where Flair's own relay went stale", () => {
    it("uses the HomeKit-derived HVAC state as authoritative, even when it disagrees with Flair's own relayed value", async () => {
      const client = new FakeFlairClient();
      // Flair says idle — the exact stale-relay symptom this was built for.
      setupFlairFixture(
        client,
        [
          {
            roomId: "room-1",
            ventId: "vent-1",
            tempC: 26,
            ductC: 14,
            percentOpen: 50,
          },
        ],
        "idle",
      );
      const homeKitClient = new FakeHomeKitClient();
      // HomeKit's own local read says the compressor is genuinely cooling.
      homeKitClient.setState({
        currentHeatingCoolingState: 2,
        currentFanState: 1,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.hvac_state).toBe("COOLING_CALL");
      expect(decision.hvac_state_source).toBe("homekit");
      expect(logSpy("warn")).toHaveBeenCalledWith(
        expect.objectContaining({
          flair_state: "IDLE",
          homekit_state: "COOLING_CALL",
          authoritative_source: "homekit",
        }),
        "HVAC state disagreement detected",
      );
    });

    it("distinguishes a real FAN_ONLY period from IDLE via HomeKit's CurrentFanState, unlike Flair's operating-state alone", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(
        client,
        [
          {
            roomId: "room-1",
            ventId: "vent-1",
            tempC: 22,
            ductC: 14,
            percentOpen: 50,
          },
        ],
        "idle",
      );
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        currentHeatingCoolingState: 0,
        currentFanState: 2,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.hvac_state).toBe("FAN_ONLY");
      expect(decision.hvac_state_source).toBe("homekit");
    });

    it("falls back to Flair's own derived state, and never logs a disagreement, when HomeKit's fan/heat-cool characteristics aren't available", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(
        client,
        [
          {
            roomId: "room-1",
            ventId: "vent-1",
            tempC: 26,
            ductC: 14,
            percentOpen: 50,
          },
        ],
        "cool",
      );
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setState({
        currentHeatingCoolingState: null,
        currentFanState: null,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.hvac_state).toBe("COOLING_CALL");
      expect(decision.hvac_state_source).toBe("flair");
      expect(logSpy("warn")).not.toHaveBeenCalledWith(
        expect.anything(),
        "HVAC state disagreement detected",
      );
    });

    it("uses Flair's own derived state for a handler still on Flair setpoint delivery, and never even attempts a HomeKit read", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(
        client,
        [
          {
            roomId: "room-1",
            ventId: "vent-1",
            tempC: 26,
            ductC: 14,
            percentOpen: 50,
          },
        ],
        "fan",
      );
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "flair" });
      const persisted = new Map<string, ZoneRuntimeState>();
      const getHomeKitClient = vi.fn();

      const deps = makeHomeKitDeps(client, null, persisted, NOW);
      deps.getHomeKitClient = getHomeKitClient;

      const decision = await runTick(airHandler, zones, makeCtx(), deps);

      expect(decision.hvac_state).toBe("FAN_ONLY");
      expect(decision.hvac_state_source).toBe("flair");
      expect(getHomeKitClient).not.toHaveBeenCalled();
    });
  });

  describe("Ecobee SmartSensor reading via HomeKit", () => {
    it("prefers a mapped, reachable SmartSensor's own reading over Flair's own relayed room reading", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 20, // Flair's own (slower-to-catch-up) relayed value
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setSensorReading("Y3H2", {
        tempC: 25,
        occupied: true,
      });
      const zones = [
        makeZone({
          id: "z1",
          flairRoomId: "room-1",
          homekitSensorSerial: "Y3H2",
        }),
      ];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      // The debounced `occupied` field's own timing is covered by "runTick
      // — live occupancy sensing"; occupiedRaw's HomeKit-preferred sourcing
      // itself is covered directly at the ingestZoneRoomReading unit level.
      expect(decision.zones[0].temp_calibrated).toBeCloseTo(25, 5);
    });

    it("falls back to Flair for a zone with no homekit_sensor_serial mapped, even on a handler in HomeKit delivery mode", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 20,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setSensorReading("some-other-zones-serial", {
        tempC: 25,
        occupied: true,
      });
      const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })]; // no mapping
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.zones[0].temp_calibrated).toBeCloseTo(20, 5);
    });

    it("falls back to Flair when the mapped serial isn't found in this tick's live HomeKit sensor reading", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 20,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient(); // no sensor readings seeded at all
      const zones = [
        makeZone({
          id: "z1",
          flairRoomId: "room-1",
          homekitSensorSerial: "Y3H2",
        }),
      ];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      expect(decision.zones[0].temp_calibrated).toBeCloseTo(20, 5);
    });

    it("falls back to Flair for every zone when the HomeKit sensor-readings fetch itself fails", async () => {
      const client = new FakeFlairClient();
      setupFlairFixture(client, [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 20,
          ductC: 14,
          percentOpen: 50,
        },
      ]);
      const homeKitClient = new FakeHomeKitClient();
      homeKitClient.setSensorReading("Y3H2", { tempC: 25, occupied: true });
      homeKitClient.getSensorReadings = async () => {
        throw new Error("simulated getAccessories failure");
      };
      const zones = [
        makeZone({
          id: "z1",
          flairRoomId: "room-1",
          homekitSensorSerial: "Y3H2",
        }),
      ];
      const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
      const persisted = new Map<string, ZoneRuntimeState>();

      const decision = await runTick(
        airHandler,
        zones,
        makeCtx(),
        makeHomeKitDeps(client, homeKitClient, persisted, NOW),
      );

      // getCurrentState() (used for HVAC state/setpoint delivery) is
      // unaffected — only the separate sensor-readings fetch failed.
      expect(decision.hvac_state_source).toBe("homekit");
      expect(decision.zones[0].temp_calibrated).toBeCloseTo(20, 5);
    });
  });
});

describe("runTick — setpoint-push termination when the last demanding zone becomes satisfied", () => {
  // A real, confirmed bug found live: the exact tick every demanding zone
  // becomes satisfied is also the tick selectDrivingZone() stops returning
  // a zone at all (eligibility requires "currently demanding") — so
  // computeSetpointPush's own termination logic (otherwise entirely
  // correct — see setpointPush.ts's own tests) never got invoked, and the
  // pushed setpoint just froze wherever it last was, however cold, with
  // nothing ever correcting it back. Confirmed live: a real cooling
  // threshold sat ~2°F below its real schedule for 3.5+ hours with zero
  // recovery. These are the missing functional tests the plan's own
  // "Prompt termination — the trigger, not just the safety guard" matrix
  // entry called for but that were never actually written — exactly the
  // gap that let this ship unnoticed.
  it("fires the termination override the instant the last demanding zone becomes satisfied, instead of freezing at the last (cold) pushed value", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 23.89, // exactly at the default fallback cool setpoint — satisfied
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    client.setThermostatState({
      thermostatId: "therm-1",
      operatingState: "cool",
      mode: "cool",
      ambientTemperatureC: 25,
      targetTemperatureC: 21,
      homeAway: "Home",
      fanState: null,
      online: true,
      written: false,
      writtenConfirmed: false,
      writtenFailures: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    // Simulates exactly what a real prior tick leaves behind while z1 was
    // still genuinely demanding and being tracked: a cold smoothed offset
    // and a correspondingly cold last-pushed value.
    const staleFrozenValue = 21.89;
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: "z1",
      ticksSinceLeadChanged: 5,
      smoothedOffsetC: -2,
      lastPushedSetpointC: staleFrozenValue,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 600_000,
      worstDeviationAtCallStartC: 1,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    // z1 is genuinely satisfied and no longer eligible to keep tracking —
    // this part of the behavior is correct and unchanged.
    expect(decision.driving_zone).toEqual({
      zone_id: null,
      reason: "none_eligible",
    });
    // But termination must still have fired this exact tick: a real write
    // happens, and the pushed value moves back up (the stop direction for
    // a cooling call) instead of staying frozen at the stale cold value.
    expect(decision.setpoint_push?.would_write).toBe(true);
    expect(decision.setpoint_push?.pushed_value).not.toBeNull();
    expect(decision.setpoint_push!.pushed_value!).toBeGreaterThan(
      staleFrozenValue,
    );
  });

  it("fires symmetrically for a heating call — moves the pushed value back down instead of staying frozen too warm", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(
      client,
      [
        {
          roomId: "room-1",
          ventId: "vent-1",
          tempC: 21.11, // exactly at the default fallback heat setpoint — satisfied
          ductC: 14,
          percentOpen: 50,
        },
      ],
      "heat",
    );
    client.setThermostatState({
      thermostatId: "therm-1",
      operatingState: "heat",
      mode: "heat",
      ambientTemperatureC: 19,
      targetTemperatureC: 21,
      homeAway: "Home",
      fanState: null,
      online: true,
      written: false,
      writtenConfirmed: false,
      writtenFailures: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    // The heating-direction mirror of the cooling test above: a stale
    // *warm* smoothed offset and a correspondingly too-warm frozen value.
    const staleFrozenValue = 23.11;
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: "z1",
      ticksSinceLeadChanged: 5,
      smoothedOffsetC: 2,
      lastPushedSetpointC: staleFrozenValue,
      lastHvacState: "HEATING_CALL",
      // Well inside the equipment-fault grace period (default 10 min) —
      // this fixture's duct-vs-room reading isn't meant to exercise that
      // check, and a duct temp colder than room during a real heating
      // call would otherwise trip it once past the grace window.
      callStartedAtMs: NOW - 60_000,
      worstDeviationAtCallStartC: 1,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.driving_zone).toEqual({
      zone_id: null,
      reason: "none_eligible",
    });
    expect(decision.setpoint_push?.would_write).toBe(true);
    expect(decision.setpoint_push?.pushed_value).not.toBeNull();
    // The stop direction for a heating call is *down*, not up.
    expect(decision.setpoint_push!.pushed_value!).toBeLessThan(
      staleFrozenValue,
    );
  });

  it("does not re-fire on a later tick once termination has already run and nothing is tracked", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 23.89,
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const persisted = new Map<string, ZoneRuntimeState>();
    const deps = makeDeps(client, persisted, NOW);
    const alreadyTerminatedValue = 22.9;
    // trackedDrivingZoneId is already null here — exactly what the fix's
    // own prior tick would have persisted right after termination fired.
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: null,
      ticksSinceLeadChanged: 0,
      smoothedOffsetC: 0,
      lastPushedSetpointC: alreadyTerminatedValue,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: null,
      worstDeviationAtCallStartC: null,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    const decision = await runTick(makeAirHandler(), zones, makeCtx(), deps);

    expect(decision.driving_zone?.reason).toBe("none_eligible");
    expect(decision.setpoint_push?.would_write).toBe(false);
    expect(decision.setpoint_push?.pushed_value).toBeCloseTo(
      alreadyTerminatedValue,
      5,
    );
  });

  // Defensive hardening requested directly after the fix above shipped:
  // the fix makes termination *fire*, but a transient dispatch failure
  // at that exact moment would otherwise still leave the real device
  // stuck — with no zone tracked anymore to retry from on the next tick.
  it("retries the termination write on the next tick if the first attempt fails, instead of abandoning it", async () => {
    const client = new FakeFlairClient();
    setupFlairFixture(client, [
      {
        roomId: "room-1",
        ventId: "vent-1",
        tempC: 23.89, // satisfied
        ductC: 14,
        percentOpen: 50,
      },
    ]);
    const zones = [makeZone({ id: "z1", flairRoomId: "room-1" })];
    const airHandler = makeAirHandler({ setpoint_delivery_mode: "homekit" });
    const persisted = new Map<string, ZoneRuntimeState>();
    const homeKitClient = new FakeHomeKitClient();
    homeKitClient.setState({ targetMode: 2, currentTempC: 25 });
    const deps = makeDeps(client, persisted, NOW);
    deps.getHomeKitClient = async () => homeKitClient;

    const staleFrozenValue = 21.89;
    await deps.airHandlerRuntimeStore.set("ah-1", {
      trackedDrivingZoneId: "z1",
      ticksSinceLeadChanged: 5,
      smoothedOffsetC: -2,
      lastPushedSetpointC: staleFrozenValue,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: NOW - 600_000,
      worstDeviationAtCallStartC: 1,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      ticksSinceDriftCheck: 0,
    });

    // Tick 1: termination fires, but the corrective write fails.
    homeKitClient.forceError(new Error("simulated transient failure"));
    const decision1 = await runTick(airHandler, zones, makeCtx(), deps);
    expect(decision1.setpoint_push?.would_write).toBe(true);
    expect(decision1.setpoint_push?.homekit_error).not.toBeNull();
    const runtimeAfterFailure = await deps.airHandlerRuntimeStore.get("ah-1");
    // The zone reference must survive the failed write — this is the
    // actual defensive mechanism: without it, the next tick would have
    // nothing left to retry from at all.
    expect(runtimeAfterFailure.trackedDrivingZoneId).toBe("z1");

    // Tick 2: same deps (retains the persisted runtime state above), the
    // transient failure has cleared — the retry now succeeds.
    homeKitClient.forceError(null);
    const decision2 = await runTick(airHandler, zones, makeCtx(), deps);
    expect(decision2.setpoint_push?.would_write).toBe(true);
    expect(decision2.setpoint_push?.homekit_error).toBeNull();
    expect(decision2.setpoint_push?.pushed_value).toBeGreaterThan(
      staleFrozenValue,
    );
    const runtimeAfterSuccess = await deps.airHandlerRuntimeStore.get("ah-1");
    // Finally released now that a real write actually succeeded.
    expect(runtimeAfterSuccess.trackedDrivingZoneId).toBeNull();
  });
});
