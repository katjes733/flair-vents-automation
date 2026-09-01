import type { StatusPalette } from "~/client/theme/statusPalette";

// Module augmentation for type-safe theme.palette.status.<key> access —
// see "MUI Theme & UI Shell" in the implementation plan.
declare module "@mui/material/styles" {
  interface Palette {
    status: StatusPalette;
  }
  interface PaletteOptions {
    status?: StatusPalette;
  }
}
