import {
  asAbsoluteTemp,
  type AbsoluteTemp,
  type TempDelta,
} from "~/shared/types/temperature";

/**
 * Applies a per-zone sensor calibration offset. Zero/unset is a no-op.
 * This is the one place the offset is ever applied — every downstream
 * consumer (deviation, tolerance, spike, setpoint push) sees only this
 * calibrated value, never the raw reading, per "Calibration offset" in the
 * unit test matrix.
 */
export function applyCalibration(
  rawTemp: AbsoluteTemp,
  offsetC: TempDelta,
): AbsoluteTemp {
  return asAbsoluteTemp(rawTemp + offsetC);
}
