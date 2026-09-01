import type { FlairClient } from "~/server/util/flair/client";

/** Pure, unit-testable rounding — no unit conversion needed at this boundary (canonical Celsius already matches what Flair wants). */
export function roundSetpointForFlair(
  setpointC: number,
  roundingC: number,
): number {
  return Math.round(setpointC / roundingC) * roundingC;
}

// Confirmed live, reproducibly, on two different vents, from multiple
// starting positions, both with Flair's own system active and later
// disabled: PATCHing `percent-open: 50` reliably returns 400 ("This
// request could not be processed"), while every neighboring value (49,
// 51+) works immediately. A real, isolated Flair API bug tied to this one
// exact value — not a timing issue, not a per-vent quirk, not related to
// the separate (and unrelated) positional-drift behavior documented in
// docs/flair-api-schema.md's live write-boundary verification section.
// Nudging away from the exact value is a safe, narrow workaround: the
// domain layer never computes or cares about "50 vs 49," so this can live
// entirely at the write boundary with no risk of masking a real decision.
const FLAIR_REJECTED_PERCENT_OPEN = 50;
const FLAIR_REJECTED_PERCENT_OPEN_NUDGE = 49;

export function avoidFlairRejectedPercentOpen(percentOpen: number): number {
  return percentOpen === FLAIR_REJECTED_PERCENT_OPEN
    ? FLAIR_REJECTED_PERCENT_OPEN_NUDGE
    : percentOpen;
}

export async function dispatchVentPosition(
  client: FlairClient,
  ventId: string,
  percentOpen: number,
): Promise<void> {
  const rounded = Math.round(percentOpen);
  await client.setVentPercentOpen(
    ventId,
    avoidFlairRejectedPercentOpen(rounded),
  );
}

/**
 * No configured-unit->Celsius conversion happens here — canonical Celsius
 * storage already is what `structures.set-point-temperature-c` wants (see
 * "Temperature units"). `roundingC` is `system_settings.config
 * .setpoint_push_rounding_c`, supplied by the caller.
 */
export async function pushSetpoint(
  client: FlairClient,
  structureId: string,
  setpointC: number,
  roundingC: number,
): Promise<number> {
  const rounded = roundSetpointForFlair(setpointC, roundingC);
  await client.setStructureSetpointC(structureId, rounded);
  return rounded;
}
