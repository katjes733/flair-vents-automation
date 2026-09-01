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
    }),
    state: { ...EMPTY_ZONE_RUNTIME_STATE, ...params.state },
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
      percentOpen: r.percentOpen,
      inactive: false,
      voltage: null,
      currentRssi: null,
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
      decision.zones.find((z) => z.zone_id === "z1")?.commanded_position_pct,
    ).toBeGreaterThan(0);
    expect(
      client
        .getVentCommandHistory()
        .map((c) => c.ventId)
        .sort(),
    ).toEqual(["vent-1", "vent-2"]);
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
      decision.zones.find((z) => z.zone_id === "z-unocc")
        ?.commanded_position_pct,
    ).toBe(50); // idle_baseline_position(100) * unoccupied_idle_factor(0.5)
    expect(
      decision.zones.find((z) => z.zone_id === "z-occ")?.commanded_position_pct,
    ).toBe(100); // occupied (Sleep Mode) — unscaled
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
          assumed_fixed_position: 40,
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
    expect(
      decision.zones.find((z) => z.zone_id === "z-manual")?.dispatch_decision,
    ).toBe("not_applicable_no_vent");
    expect(
      decision.zones.find((z) => z.zone_id === "z-no-vent")?.dispatch_decision,
    ).toBe("not_applicable_no_vent");
    // The manual vent's fixed position is real airflow the pressure math
    // must still account for — never zero, never excluded like no_vent.
    expect(decision.pressure?.aggregate_open_lps).toBeGreaterThan(0);
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
  });
});

describe("runTick — stale sensor safeguard", () => {
  it("excludes a frozen reading from the position pipeline and closes it toward its floor", async () => {
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
    expect(zoneDecision?.commanded_position_pct).toBeLessThan(100);
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
    expect(decision.zones[0].commanded_position_pct).toBeGreaterThan(0);
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
    expect(z1.commanded_position_pct!).toBeGreaterThanOrEqual(
      z2.commanded_position_pct!,
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
          reconcile_attempts: 3, // already at the default max (3)
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    const deps = makeDeps(client, persisted, NOW);
    await deps.reconciliationQueue.enqueue("z1", NOW); // due right now

    await runTick(makeAirHandler(), zones, ctx, deps);

    expect(persisted.get("z1")?.degraded).toBe(true);
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
          reconcile_attempts: 1,
          degraded: true,
        },
      }),
    ];
    const persisted = new Map<string, ZoneRuntimeState>();
    const ctx = makeCtx();
    const deps = makeDeps(client, persisted, NOW);
    await deps.reconciliationQueue.enqueue("z1", NOW);

    await runTick(makeAirHandler(), zones, ctx, deps);

    expect(persisted.get("z1")?.reconcile_attempts).toBe(0);
    expect(persisted.get("z1")?.degraded).toBe(false);
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

    expect(enqueueSpy).toHaveBeenCalledWith("z1", NOW);
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
      decision.zones.find((z) => z.zone_id === "z-away")
        ?.commanded_position_pct,
    ).toBe(0);
    expect(
      decision.zones.find((z) => z.zone_id === "z-home")?.classification,
    ).toBe("demanding");
    expect(
      decision.zones.find((z) => z.zone_id === "z-home")
        ?.commanded_position_pct,
    ).toBeGreaterThan(0);
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
        state: { last_target_position: 50, last_reported_position: 40 },
      }),
      makeZone({
        id: "z2",
        flairRoomId: "room-2",
        state: { last_target_position: 50, last_reported_position: 40 },
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

    await runTick(
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
