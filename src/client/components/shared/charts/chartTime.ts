// Formats an epoch-ms timestamp for a chart axis/tooltip in the viewer's own
// browser timezone. Unlike schedule evaluation (which is pinned to the
// house's configured home timezone, since it governs when a real event
// fires), a historical-chart label has no correctness stakes either way —
// so this deliberately doesn't plumb `system_settings.config.home_timezone`
// through just to read a chart.
export function formatChartTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatChartDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
