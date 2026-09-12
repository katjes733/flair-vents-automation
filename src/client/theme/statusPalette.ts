export interface StatusPalette {
  satisfied: string;
  demanding: string;
  spiking: string;
  degradedVent: string;
  staleReading: string;
  manualOverride: string;
  away: string;
  emergency: string;
  occupied: string;
}

// One fixed status vocabulary, defined once here rather than each
// component hardcoding a color ad hoc — otherwise dark mode drifts and
// the spec's explicit "stale-reading must look distinct from
// degraded-vent" requirement erodes over time. See "MUI Theme & UI
// Shell" in the implementation plan.
export const lightStatusPalette: StatusPalette = {
  satisfied: "#2e7d32",
  demanding: "#ed6c02",
  spiking: "#d32f2f",
  degradedVent: "#9c27b0",
  staleReading: "#757575",
  manualOverride: "#0288d1",
  away: "#5c6bc0",
  emergency: "#c62828",
  // Validated against this theme's default MUI primary (#1976d2, the
  // temperature-chart line it's always plotted alongside) via
  // dataviz's validate_palette.js — teal 600 clears CVD separation and
  // the normal-vision floor cleanly. See ZoneTemperatureChart's own
  // comment for why a lighter/more pastel teal fails against dark mode's
  // primary (#90caf9) and was rejected in favor of this more saturated one.
  occupied: "#00897b",
};

export const darkStatusPalette: StatusPalette = {
  satisfied: "#66bb6a",
  demanding: "#ffa726",
  spiking: "#ef5350",
  degradedVent: "#ce93d8",
  staleReading: "#bdbdbd",
  manualOverride: "#4fc3f7",
  away: "#7986cb",
  emergency: "#ff5252",
  occupied: "#26a69a",
};
