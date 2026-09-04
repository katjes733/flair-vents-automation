import { useCallback, useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from "recharts";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useDragZoom } from "~/client/components/shared/charts/useDragZoom";
import TouchSafeChartFrame from "~/client/components/shared/charts/TouchSafeChartFrame";
import ZoomResetButton from "~/client/components/shared/charts/ZoomResetButton";
import { formatChartTime } from "~/client/components/shared/charts/chartTime";
import ChartTooltip, {
  type ChartTooltipRow,
} from "~/client/components/shared/charts/ChartTooltip";
import {
  buildVentPositionData,
  computeDegradedPeriodsForVent,
} from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface VentPositionChartProps {
  points: TickHistoryPoint[];
  zoneId: string;
  flairVentId: string;
  height?: number;
}

// One vent's commanded vs. reported position over time, with degraded
// periods shaded — see "Stage 13, Increment B".
export default function VentPositionChart({
  points,
  zoneId,
  flairVentId,
  height = 200,
}: VentPositionChartProps) {
  const theme = useTheme();

  const data = useMemo(
    () => buildVentPositionData(points, zoneId, flairVentId),
    [points, zoneId, flairVentId],
  );

  const {
    zoomDomain,
    dragStart,
    dragEnd,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    resetZoom,
  } = useDragZoom(60_000);

  const displayData = useMemo(() => {
    if (!zoomDomain) return data;
    const [from, to] = zoomDomain;
    return data.filter((d) => d.time >= from && d.time <= to);
  }, [data, zoomDomain]);

  const xDomain = useMemo((): [number, number] => {
    if (zoomDomain) return zoomDomain;
    if (data.length === 0) return [0, 1];
    return [data[0].time, data[data.length - 1].time];
  }, [zoomDomain, data]);

  const degradedPeriods = useMemo(() => {
    if (data.length === 0) return [];
    return computeDegradedPeriodsForVent(
      points,
      zoneId,
      flairVentId,
      data[data.length - 1].time,
    );
  }, [points, zoneId, flairVentId, data]);

  const renderTooltip = useCallback(
    (props: {
      active?: boolean;
      payload?: readonly unknown[];
      label?: number | string;
    }) => {
      if (!props.active || !props.payload?.length || props.label == null)
        return null;
      const payload = props.payload as {
        dataKey?: string;
        value?: number | null;
      }[];
      const rows: ChartTooltipRow[] = [];
      const commandedEntry = payload.find((p) => p.dataKey === "commanded");
      const reportedEntry = payload.find((p) => p.dataKey === "reported");
      if (commandedEntry?.value != null) {
        rows.push({
          label: "Commanded",
          value: `${commandedEntry.value.toFixed(0)}%`,
          color: theme.palette.primary.main,
        });
      }
      if (reportedEntry?.value != null) {
        rows.push({
          label: "Reported",
          value: `${reportedEntry.value.toFixed(0)}%`,
          color: theme.palette.text.secondary,
        });
      }
      return <ChartTooltip timeMs={Number(props.label)} rows={rows} />;
    },
    [theme],
  );

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No data in this window yet.
      </Typography>
    );
  }

  return (
    <Box position="relative">
      {zoomDomain && <ZoomResetButton onClick={resetZoom} />}
      <TouchSafeChartFrame height={height} onDoubleClick={resetZoom}>
        <ComposedChart
          data={displayData}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <CartesianGrid
            vertical={false}
            stroke={theme.palette.divider}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(v: number) => formatChartTime(v)}
            tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
            tickLine={{ stroke: theme.palette.divider }}
            axisLine={{ stroke: theme.palette.divider }}
            minTickGap={40}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={renderTooltip}
            cursor={{ stroke: theme.palette.divider, strokeWidth: 1 }}
          />
          {degradedPeriods.map((p) => (
            <ReferenceArea
              key={p.startMs}
              x1={p.startMs}
              x2={p.endMs}
              fill={theme.palette.status.degradedVent}
              fillOpacity={0.15}
              ifOverflow="visible"
            />
          ))}
          {dragStart != null && dragEnd != null && (
            <ReferenceArea
              x1={Math.min(dragStart, dragEnd)}
              x2={Math.max(dragStart, dragEnd)}
              fill={theme.palette.primary.main}
              fillOpacity={0.08}
            />
          )}
          <Line
            type="stepAfter"
            dataKey="commanded"
            name="Commanded"
            stroke={theme.palette.primary.main}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="reported"
            name="Reported"
            stroke={theme.palette.text.secondary}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </TouchSafeChartFrame>
    </Box>
  );
}
