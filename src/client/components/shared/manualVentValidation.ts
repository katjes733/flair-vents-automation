// Split from RepeatableManualVentField.tsx — a component file exporting a
// plain function (alongside its default component export) breaks React
// Fast Refresh (react-refresh/only-export-components).

/** Shared Create/Save gating check — a manual vent's position is required, 0-100. */
export function isValidManualVentPosition(position: string): boolean {
  if (position.trim() === "") return false;
  const n = Number(position);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}
