export interface StatusPalette {
  satisfied: string;
  demanding: string;
  spiking: string;
  degradedVent: string;
  staleReading: string;
  manualOverride: string;
  away: string;
  emergency: string;
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
};
