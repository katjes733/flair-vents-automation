// Canonical SI storage: every temperature value in this app is always
// Celsius internally, storage and domain math alike — unit preference lives
// entirely at the display/input boundary. See "Temperature units" in the
// implementation plan.
//
// Two distinct branded types, not one plain `number`, because an absolute
// temperature and a temperature *difference* convert differently — an
// absolute value needs the full formula (C = (F-32)*5/9), a delta only
// needs the scale factor (*5/9). Applying the absolute formula to a delta is
// a real, silent-bug-shaped mistake (a "3°F band width" would not become "a
// band centered near -16°C"). Branding makes the type system reject passing
// the wrong kind to the wrong conversion function.

declare const AbsoluteTempBrand: unique symbol;
/** A real point on the temperature scale (a setpoint, a reading), always Celsius. */
export type AbsoluteTemp = number & { readonly [AbsoluteTempBrand]: true };

declare const TempDeltaBrand: unique symbol;
/** A temperature *difference* (a tolerance, a band width, an offset), always Celsius-scaled. */
export type TempDelta = number & { readonly [TempDeltaBrand]: true };

export function asAbsoluteTemp(celsius: number): AbsoluteTemp {
  return celsius as AbsoluteTemp;
}

export function asTempDelta(celsiusDelta: number): TempDelta {
  return celsiusDelta as TempDelta;
}

export type TemperatureUnit = "C" | "F";

/** Converts a stored absolute Celsius value to whatever unit a viewer prefers. */
export function toDisplayAbsolute(
  celsius: AbsoluteTemp,
  unit: TemperatureUnit,
): number {
  return unit === "F" ? celsius * (9 / 5) + 32 : celsius;
}

/** Converts a viewer-entered absolute value back to canonical Celsius for storage. */
export function fromDisplayAbsolute(
  value: number,
  unit: TemperatureUnit,
): AbsoluteTemp {
  return asAbsoluteTemp(unit === "F" ? ((value - 32) * 5) / 9 : value);
}

/** Converts a stored Celsius-scaled delta to whatever unit a viewer prefers. */
export function toDisplayDelta(
  celsiusDelta: TempDelta,
  unit: TemperatureUnit,
): number {
  return unit === "F" ? celsiusDelta * (9 / 5) : celsiusDelta;
}

/** Converts a viewer-entered delta back to a canonical Celsius-scaled delta for storage. */
export function fromDisplayDelta(
  value: number,
  unit: TemperatureUnit,
): TempDelta {
  return asTempDelta(unit === "F" ? (value * 5) / 9 : value);
}
