import { describe, it, expect } from "vitest";
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

// The release-gating test the Verification Plan names explicitly: "the one
// place a subtly wrong implementation is actively unsafe rather than merely
// incorrect." A staged (non-bridged) system can escalate to a second
// compressor stage if it perceives more urgency than really exists — this
// asserts the pushed setpoint never manufactures that urgency, across a
// simulated converging call and a genuine mid-call driving-zone switch,
// under both a two_stage and a variable_speed topology. The mechanism
// itself never reads topologyMode at all (see "Equipment generality"), so
// re-running under both isn't exercising different code paths — it's
// direct evidence that the safety property is topology-agnostic by
// construction, not by accident of whichever topology happened to be
// tested.

const STRUCTURE_ID = "structure-1";
const FLAIR_ZONE_ID = "flair-zone-1";
const NOW = Date.UTC(2024, 0, 1, 12, 0);
const SETPOINT_C = 21;
const THERMOSTAT_READING_C = 23; // Ecobee's own sensor — deliberately unrelated to either zone's temperature.

function makeAirHandler(
  topologyMode: "two_stage" | "variable_speed",
): AirHandlerData {
  return {
    id: "ah-1",
    installationId: "inst-1",
    flairZoneId: FLAIR_ZONE_ID,
    name: "Upstairs",
    active: true,
    config: resolveAirHandlerConfig({
      topology_mode: topologyMode,
      tonnage_tons: 5,
      blower_rated_flow_rate_lps: 921,
      blower_rated_flow_rate_is_estimate: false,
      minimum_aggregate_flow_lps: 5,
      minimum_aggregate_flow_is_estimate: false,
    }),
  };
}

function makeZone(
  id: string,
  flairRoomId: string,
  state: ZoneRuntimeState,
): ZoneData {
  return {
    id,
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId,
    name: id,
    ventHardwareType: "flair_smart_vent",
    config: resolveZoneConfig({
      has_temperature_sensor: true,
      idle_baseline_position: 100,
    }),
    state,
  };
}

function makeCtx(): TickContext {
  return {
    installationId: "inst-1",
    structureId: STRUCTURE_ID,
    settings: {
      ...resolveSystemSettings({}),
      home_timezone: "UTC",
      live_air_handler_ids: ["ah-1"],
    },
    schedules: [
      {
        id: "sched-1",
        installationId: "inst-1",
        name: "Fixed setpoints",
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
                zone_id: "z-hot",
                cool_setpoint: SETPOINT_C,
                heat_setpoint: 19,
                assume_occupied: false,
              },
              {
                zone_id: "z-warm",
                cool_setpoint: SETPOINT_C,
                heat_setpoint: 19,
                assume_occupied: false,
              },
            ],
          },
        ],
      },
    ],
    overridesByZoneId: new Map(),
    globalDryRun: false,
  };
}

function makeDeps(
  client: FakeFlairClient,
  persisted: Map<string, ZoneRuntimeState>,
): TickDeps {
  return {
    client,
    reconciliationQueue: createInMemoryReconciliationQueue(),
    spikeBufferStore: createInMemorySpikeBufferStore(),
    airHandlerRuntimeStore: createInMemoryAirHandlerRuntimeStore(),
    zoneDemandTrackingStore: createInMemoryZoneDemandTrackingStore(),
    alerting: createInMemoryAlertingClient(),
    persistZoneState: async (zoneId, patch) => {
      const current = persisted.get(zoneId) ?? EMPTY_ZONE_RUNTIME_STATE;
      persisted.set(zoneId, { ...current, ...patch });
    },
    now: () => NOW,
  };
}

function setFixture(
  client: FakeFlairClient,
  hotTempC: number,
  warmTempC: number,
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
    operatingState: "cool",
    mode: "cool",
    ambientTemperatureC: THERMOSTAT_READING_C,
    targetTemperatureC: SETPOINT_C,
    homeAway: "Home",
    fanState: null,
    online: true,
    written: false,
    writtenConfirmed: false,
    writtenFailures: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  });
  const rooms = [
    { roomId: "room-hot", ventId: "vent-hot", tempC: hotTempC },
    { roomId: "room-warm", ventId: "vent-warm", tempC: warmTempC },
  ];
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
      percentOpen: 50,
      inactive: false,
      voltage: null,
      currentRssi: null,
    })),
  );
  for (const r of rooms) {
    client.setVentReading({
      ventId: r.ventId,
      percentOpen: 50,
      ductTemperatureC: 14,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
  }
}

async function simulateConvergingCall(
  topologyMode: "two_stage" | "variable_speed",
) {
  const client = new FakeFlairClient();
  const persisted = new Map<string, ZoneRuntimeState>();
  const deps = makeDeps(client, persisted);
  const ctx = makeCtx();
  const airHandler = makeAirHandler(topologyMode);

  // "hot" starts far over setpoint (worst-off, tracked first) and cools
  // toward it; "warm" starts closer but keeps heating up, overtaking
  // "hot" partway through — forcing a genuine mid-call tracked-zone
  // switch (verified by hand against selectDrivingZone's actual hysteresis
  // semantics: the incumbent has already been tracked long enough by the
  // time the challenger's margin is exceeded, so the switch fires the
  // very tick the lead changes, not several ticks later).
  let hotTempC = 26;
  let warmTempC = 23;
  let hotState: ZoneRuntimeState = { ...EMPTY_ZONE_RUNTIME_STATE };
  let warmState: ZoneRuntimeState = { ...EMPTY_ZONE_RUNTIME_STATE };

  const samples: Array<{
    tick: number;
    trackedZoneId: string | null;
    pushedGap: number;
    realGap: number;
  }> = [];

  for (let tick = 0; tick < 6; tick++) {
    setFixture(client, hotTempC, warmTempC);
    const zones = [
      makeZone("z-hot", "room-hot", hotState),
      makeZone("z-warm", "room-warm", warmState),
    ];

    const decision = await runTick(airHandler, zones, ctx, deps);

    hotState = persisted.get("z-hot") ?? hotState;
    warmState = persisted.get("z-warm") ?? warmState;

    const trackedZoneId = decision.driving_zone?.zone_id ?? null;
    const trackedTempC = trackedZoneId === "z-hot" ? hotTempC : warmTempC;
    const pushedValue = decision.setpoint_push?.pushed_value ?? null;
    const thermostatReading =
      decision.setpoint_push?.thermostat_reading ?? null;
    if (trackedZoneId && pushedValue !== null && thermostatReading !== null) {
      samples.push({
        tick,
        trackedZoneId,
        pushedGap: Math.abs(thermostatReading - pushedValue),
        realGap: Math.abs(trackedTempC - SETPOINT_C),
      });
    }

    hotTempC = Math.max(21.5, hotTempC - 0.8);
    warmTempC = Math.min(25, warmTempC + 0.6);
  }

  return samples;
}

describe.each(["two_stage", "variable_speed"] as const)(
  "runTick — cross-system-type setpoint-push safety (%s)",
  (topologyMode) => {
    it("never pushes a gap larger than the currently-tracked zone's real gap, including across a mid-call tracked-zone switch", async () => {
      const samples = await simulateConvergingCall(topologyMode);

      // The simulation must actually exercise a mid-call switch, or this
      // test isn't testing what it claims to.
      const distinctTrackedZones = new Set(samples.map((s) => s.trackedZoneId));
      expect(distinctTrackedZones.size).toBe(2);

      for (const sample of samples) {
        expect(sample.pushedGap).toBeLessThanOrEqual(sample.realGap + 1e-6);
      }
    });
  },
);
