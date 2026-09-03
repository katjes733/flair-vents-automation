// Rated max airflow (L/s) for common residential register sizes, sourced
// from real manufacturer/distributor spec pages (TRUaire 103M/104M series)
// rather than a guessed or interpolated table — see
// docs/hvac-pressure-research.md's "Register Size to Airflow Rating"
// section for the full sourcing, per-row citations, and the one flagged
// gap (8x10, whose CFM figure is manufacturer-verified but whose
// free-area/range data wasn't found on any page checked). Values here are
// each SKU's own published "rated max" — the top of its Flow Rate range,
// or its single stated design-point value for the one SKU rated that way
// (10x12) — converted at 1 CFM = 0.4719 L/s, matching this app's existing
// airflow-unit convention.
//
// This is a convenience autofill for the raw duct_flow_rate_lps field, not
// a second source of truth: picking a size just writes a number into that
// same field, which stays freely editable afterward — see
// VentAirflowRatingField.tsx.
export const VENT_SIZES = [
  "4x10",
  "4x12",
  "6x6",
  "6x10",
  "6x12",
  "8x8",
  "8x10",
  "8x12",
  "10x10",
  "10x12",
  "12x12",
  "14x14",
] as const;
export type VentSize = (typeof VENT_SIZES)[number];

export const VENT_SIZE_RATED_FLOW_RATE_LPS: Record<VentSize, number> = {
  "4x10": 54.3,
  "4x12": 66.1,
  "6x6": 49.6,
  "6x10": 87.3,
  "6x12": 106.2,
  "8x8": 94.4,
  "8x10": 139.2,
  "8x12": 151.0,
  "10x10": 146.3,
  "10x12": 193.5,
  "12x12": 221.8,
  "14x14": 306.7,
};
