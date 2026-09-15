import type { AbsoluteTemp, TempDelta } from "~/shared/types/temperature";
import type { ThermalLoadFlag } from "~/shared/schemas/zoneConfig";
import type { HvacCallState, ModifierBoosts } from "~/server/domain/types";
import { computeDeviation } from "~/server/domain/targets/comfortTolerance";

export interface DesiredPositionInput {
  // idleBaselinePosition is the caller's *effective* idle baseline (see
  // sensors/occupancy.ts's effectiveIdleBaseline) — occupancy-scaling
  // happens before this function ever runs, not inside it, so this
  // signature only ever needs one number to scale from.
  idleBaselinePosition: number;
  minVentPosition: number;
  maxVentPosition: number;
  thermalLoadFlags: ThermalLoadFlag[];
  // The caller's already-*stabilized* satisfied/demanding decision (see
  // comfortTolerance.ts's stabilizeClassification) — this function no
  // longer derives it internally via a fresh, unstabilized classifyZone
  // call, so a single-tick noise blip in the raw reading can't flip which
  // branch runs here out from under the caller's own hysteresis dwell.
  demanding: boolean;
  // Whether the *previous* tick's own stabilized classification was
  // already "demanding" — i.e. classifyZone's own `wasDemanding`, mirrored
  // here for the ramp's benefit. See the demanding branch's own comment on
  // why this needs its own asymmetric edge, same as classifyZone already
  // has for the label itself.
  wasDemanding: boolean;
  state: HvacCallState;
  calibratedTemp: AbsoluteTemp;
  resolvedSetpoint: AbsoluteTemp;
  // Asymmetric — see zoneConfigSchema's own comment on
  // comfort_demand_tolerance/comfort_overshoot_tolerance. demandTolerance
  // governs the ramp-up-when-demanding edge below; overshootTolerance
  // governs the ramp-down-when-satisfied edge.
  demandTolerance: TempDelta | null;
  overshootTolerance: TempDelta | null;
  occupied: boolean;
  spiking: boolean;
  settings: {
    proportionalBandWidthC: TempDelta;
    maxPositionPct: number;
    modifierBoosts: ModifierBoosts;
    heatingChokePositionPct: number;
    // Reused here as the demanding branch's own minimum step above
    // idleBaselinePosition — see the demand-floor comment below. Same
    // grid Step 2 (rampTowardTarget) quantizes to; deliberately not a
    // separate setting of its own.
    modulationStepPct: number;
  };
}

export interface DesiredPositionResult {
  desiredPosition: number;
  deviation: number;
  clampedBy: string | null;
}

/**
 * The proportional position math — see "Step 1 — desired proportional
 * position". `demand = COOLING_CALL ? temp-setpoint : setpoint-temp`.
 * Modifiers narrow the effective band width (`bandWidth / (1 + Σboosts)`)
 * rather than adding to the output, so they compose cleanly and saturate
 * naturally at the ceiling. Both thermal-load-flag boosts apply during
 * COOLING_CALL; distant_high_duct_loss additionally persists into
 * HEATING_CALL (direction-agnostic), while high_internal_heat_load instead
 * inverts to a choke override in HEATING_CALL (along with any actively
 * spiking zone). The demanding branch's own effective tolerance edge is
 * asymmetric once a zone is already demanding, not just on fresh entry —
 * see its own comment for why (a real "AC runs forever, starved zone never
 * reaches setpoint" incident this fixes).
 */
export function computeDesiredPosition(
  i: DesiredPositionInput,
): DesiredPositionResult {
  const demanding = i.demanding;
  const deviation = computeDeviation(
    i.state,
    i.calibratedTemp,
    i.resolvedSetpoint,
  );
  // Same asymmetric edges classifyZone's own hysteresis uses (see its doc
  // comment) — each branch below zeroes out exactly at its own edge, so a
  // zone's desired position is continuous across the classification flip
  // in either direction, never a jump.
  const demandToleranceC = i.demandTolerance ?? 0;
  const overshootToleranceC = i.overshootTolerance ?? 0;

  const { maxPositionPct, modifierBoosts } = i.settings;

  // Pin-and-warn: a misconfigured system max below the zone's own idle
  // baseline has nowhere sensible to scale toward.
  if (maxPositionPct < i.idleBaselinePosition) {
    return {
      desiredPosition: maxPositionPct,
      deviation,
      clampedBy: "max_position_below_idle_baseline",
    };
  }

  // Computed unconditionally — both the demanding (ramp up) and satisfied
  // (ramp down) branches below scale across the identical band, so a boost
  // that narrows one side narrows the other too, symmetrically.
  const boosts: number[] = [];
  if (i.occupied) boosts.push(modifierBoosts.occupancy);
  if (i.spiking) boosts.push(modifierBoosts.spike);
  if (
    i.state === "COOLING_CALL" &&
    i.thermalLoadFlags.includes("high_internal_heat_load")
  ) {
    boosts.push(modifierBoosts.highInternalHeatLoad);
  }
  if (i.thermalLoadFlags.includes("distant_high_duct_loss")) {
    boosts.push(modifierBoosts.distantHighDuctLoss);
  }
  const sumBoosts = boosts.reduce((a, b) => a + b, 0);
  const effectiveBand = i.settings.proportionalBandWidthC / (1 + sumBoosts);

  if (!demanding) {
    // The goal is staying as close to target as possible at all times, not
    // "hold idle baseline until demanding again" — so a satisfied zone
    // keeps closing past the comfort boundary rather than snapping flat.
    // Mirrors the demanding ramp exactly: `overshoot` (how far past the
    // tolerance edge, in the "too satisfied" direction) plays the same
    // role `effectiveDemand` plays below, scaled by the same effectiveBand,
    // running from idleBaselinePosition (overshoot=0, i.e. exactly at the
    // demanding/satisfied boundary — continuous with the demanding
    // branch's own ratio=0 value) down to minVentPosition (overshoot >=
    // effectiveBand). This applies regardless of occupancy: an occupied
    // room that keeps getting colder closes down just like an empty one —
    // "occupied" only still matters via the occupancy boost narrowing (or
    // not) the band itself, same as it already does on the demanding side.
    // See "Occupancy" — this replaces effectiveIdleBaseline's old flat
    // idleBaselinePosition return for a satisfied zone during an active
    // call, which had no mechanism to correct an already-overcooled room.
    const overshoot = Math.max(0, -overshootToleranceC - deviation);
    const closeRatio =
      effectiveBand > 0 ? Math.min(1, overshoot / effectiveBand) : 1;
    const desiredPosition =
      i.idleBaselinePosition -
      (i.idleBaselinePosition - i.minVentPosition) * closeRatio;
    return {
      desiredPosition,
      deviation,
      clampedBy: null,
    };
  }

  // A real, confirmed incident (2026-09-15, Martin Office): a zone that's
  // *already* demanding stayed classified that way — correctly, per
  // classifyZone's own asymmetric hysteresis, which only requires
  // `deviation > -overshootToleranceC` (not the full demandToleranceC) to
  // *stay* demanding once it's already there — while this ramp kept
  // anchoring to demandToleranceC regardless, computing an effectiveDemand
  // near zero for the entire stretch between setpoint and
  // setpoint+demandTolerance. The result: a zone labeled "Demanding" but
  // floored to a bare trickle, with real, non-trivial deviation left to
  // close (e.g. a genuine 0.9°F short of setpoint computed only a 10%
  // target). If that trickle isn't enough real airflow to finish the job,
  // the zone can plateau indefinitely in that band — never accumulating
  // enough cooling to cross back to satisfied, never getting more than a
  // trickle because the ramp thinks demand is basically zero — which keeps
  // the whole air handler's call alive forever and overcools every other
  // (especially manual/uncontrolled) zone sharing it. A real thermostat's
  // deadband governs only *when* to start/stop calling; it doesn't also
  // throttle back effort mid-call just because the remaining gap happens
  // to be smaller than the entry threshold. This mirrors that: once a zone
  // is *already* demanding (not freshly entering this tick), the ramp
  // switches to the same edge classifyZone itself would use to let the
  // zone go satisfied again (-overshootToleranceC, i.e. literal setpoint
  // when overshoot is 0) — so it keeps pushing real, meaningfully-scaled
  // airflow all the way down to the point that would actually satisfy it,
  // not just down to the entry threshold. Continuity at the fresh-entry
  // transition itself is preserved (demandToleranceC still governs that
  // one tick, matching the satisfied branch's own flat idleBaselinePosition
  // output for the entire deviation-in-(-(overshoot), demandTolerance]
  // range) — the one-tick step up in ambition the tick after genuinely
  // confirmed, sustained demand is deliberate, not noise-driven: it only
  // fires once per demand episode, gated on the same already-stabilized
  // signal classifyZone's own hysteresis uses, never on raw per-tick
  // wobble. To verify this actually closes the gap in practice (not just
  // in theory): pull a zone's tick-decision history for an episode where
  // it enters demanding and confirm desired_position_pct now scales with
  // the full remaining deviation, and that temp_calibrated actually
  // reaches resolved_setpoint rather than plateauing partway — the same
  // Loki-query method used to diagnose the original incident.
  const effectiveToleranceC = i.wasDemanding
    ? -overshootToleranceC
    : demandToleranceC;
  const effectiveDemand = Math.max(0, deviation - effectiveToleranceC);
  const ratio =
    effectiveBand > 0 ? Math.min(1, effectiveDemand / effectiveBand) : 1;
  let desiredPosition =
    i.idleBaselinePosition + (maxPositionPct - i.idleBaselinePosition) * ratio;
  let clampedBy: string | null = null;

  // Demand floor: "demanding" and "satisfied" are supposed to be
  // operationally distinct states, not just labels — a zone whose ratio
  // rounds down near 0 here computes the *same* position a satisfied zone
  // rests at, which means it never actually pursues comfort and is left
  // hoping incidental leakage from a sibling zone's ducting happens to
  // help (confirmed live: Martin Bedroom sat "demanding" for 53 straight
  // minutes at a literal 0% target once comfort_idle_baseline_position
  // moved to 0, since ratio≈0 near the demand-tolerance edge now lands
  // exactly on idleBaselinePosition instead of the old 100%-default idle
  // baseline that accidentally made this a non-issue). Applied *before*
  // the heating-choke safety clamp below, deliberately — the choke's job
  // is to cap the position back down regardless of how it got here, so it
  // must keep final say even over this floor.
  const demandFloor = i.idleBaselinePosition + i.settings.modulationStepPct;
  if (desiredPosition < demandFloor) {
    desiredPosition = demandFloor;
    clampedBy = "demand_floor";
  }

  const chokeCandidate =
    i.state === "HEATING_CALL" &&
    (i.thermalLoadFlags.includes("high_internal_heat_load") || i.spiking);
  if (chokeCandidate && desiredPosition > i.settings.heatingChokePositionPct) {
    desiredPosition = i.settings.heatingChokePositionPct;
    clampedBy = "heating_choke";
  }

  // Unconditional from here on (not `?? clampedBy`) — with the demand
  // floor above now able to fire before either of these, clampedBy should
  // always reflect whichever clamp actually determined the *final* value,
  // not just whichever fired first.
  if (desiredPosition < i.minVentPosition) {
    desiredPosition = i.minVentPosition;
    clampedBy = "zone_min";
  } else if (desiredPosition > i.maxVentPosition) {
    desiredPosition = i.maxVentPosition;
    clampedBy = "zone_max";
  }

  return { desiredPosition, deviation, clampedBy };
}
