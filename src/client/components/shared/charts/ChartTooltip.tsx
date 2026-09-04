import { useTheme } from "@mui/material/styles";
import { formatChartDateTime } from "~/client/components/shared/charts/chartTime";

export interface ChartTooltipRow {
  label: string;
  value: string;
  color: string;
}

interface ChartTooltipProps {
  timeMs: number;
  rows: ChartTooltipRow[];
}

// Shared by every line/area chart in telemetry/ — the same small
// background+border+rows shape each of tesla-powerwall-automation's own
// chart tooltips builds ad hoc per component; pulled into one place here
// since this app has more than two consumers of it.
export default function ChartTooltip({ timeMs, rows }: ChartTooltipProps) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        padding: "6px 10px",
        borderRadius: 4,
        fontSize: 12,
        color: theme.palette.text.primary,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {formatChartDateTime(timeMs)}
      </div>
      {rows.map((r) => (
        <div key={r.label}>
          <span style={{ color: r.color }}>●</span> {r.label}: <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}
