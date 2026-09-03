// Canonical storage: every airflow rate in this app is always L/s
// internally (duct_flow_rate_lps, blower_rated_flow_rate_lps,
// minimum_aggregate_flow_lps) — unit preference lives entirely at the
// display/input boundary, the identical pattern to "Temperature units" in
// the implementation plan (src/shared/types/temperature.ts). Unlike
// temperature, airflow has no absolute-vs-delta distinction to worry about
// — it's always a plain, always-positive rate — so this is a single
// conversion pair, not two.

export type AirflowUnit = "Lps" | "CFM" | "M3h";

const LPS_PER_CFM = 0.4719474432;
const LPS_PER_M3H = 1000 / 3600;

/** Converts a stored L/s value to whatever unit a viewer prefers. */
export function toDisplayFlowRate(lps: number, unit: AirflowUnit): number {
  switch (unit) {
    case "CFM":
      return lps / LPS_PER_CFM;
    case "M3h":
      return lps / LPS_PER_M3H;
    default:
      return lps;
  }
}

/** Converts a viewer-entered value back to canonical L/s for storage. */
export function fromDisplayFlowRate(value: number, unit: AirflowUnit): number {
  switch (unit) {
    case "CFM":
      return value * LPS_PER_CFM;
    case "M3h":
      return value * LPS_PER_M3H;
    default:
      return value;
  }
}

export const AIRFLOW_UNIT_LABELS: Record<AirflowUnit, string> = {
  Lps: "L/s",
  CFM: "CFM",
  M3h: "m³/h",
};
