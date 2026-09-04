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
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { niceTickInterval } from "~/client/components/shared/charts/chartMath";
import { useDragZoom } from "~/client/components/shared/charts/useDragZoom";
import TouchSafeChartFrame from "~/client/components/shared/charts/TouchSafeChartFrame";
import ZoomResetButton from "~/client/components/shared/charts/ZoomResetButton";
import { formatChartTime } from "~/client/components/shared/charts/chartTime";
import ChartTooltip, {
  type ChartTooltipRow,
} from "~/client/components/shared/charts/ChartTooltip";
import { buildZoneTemperatureData } from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface ZoneTemperatureChartProps {
  points: TickHistoryPoint[];
  zoneId: string;
  height?: number;
}

// One zone's calibrated reading vs. its resolved setpoint over time — see
// "Stage 13, Increment B". `temp_calibrated` only exists on
// `AirHandlerTickDecision` because it was added specifically to back this
// chart (see tickDecision.ts) rather than needing the debug-only `Zone
// evaluated` event, which the deployed app's LOG_LEVEL=info never logs.
export default function ZoneTemperatureChart({
  points,
  zoneId,
  height = 200,
}: ZoneTemperatureChartProps) {
  const theme = useTheme();
  const { temperatureUnit } = useDisplayUnit();

  const data = useMemo(
    () => buildZoneTemperatureData(points, zoneId, temperatureUnit),
    [points, zoneId, temperatureUnit],
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

  const yTicks = useMemo(() => {
    const values = data.flatMap((d) =>
      [d.temp, d.setpoint].filter((v): v is number => v !== null),
    );
    if (values.length === 0) return undefined;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const interval = niceTickInterval(min, max);
    const domainMin = Math.floor(min / interval) * interval;
    const domainMax = Math.ceil(max / interval) * interval;
    const ticks: number[] = [];
    for (let v = domainMin; v <= domainMax + 1e-9; v += interval) {
      ticks.push(Math.round(v / interval) * interval);
    }
    return ticks;
  }, [data]);

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
      const tempEntry = payload.find((p) => p.dataKey === "temp");
      const setpointEntry = payload.find((p) => p.dataKey === "setpoint");
      if (tempEntry?.value != null) {
        rows.push({
          label: "Temperature",
          value: `${tempEntry.value.toFixed(1)}°${temperatureUnit}`,
          color: theme.palette.primary.main,
        });
      }
      if (setpointEntry?.value != null) {
        rows.push({
          label: "Setpoint",
          value: `${setpointEntry.value.toFixed(1)}°${temperatureUnit}`,
          color: theme.palette.text.secondary,
        });
      }
      return <ChartTooltip timeMs={Number(props.label)} rows={rows} />;
    },
    [theme, temperatureUnit],
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
            ticks={yTicks}
            domain={yTicks ? [yTicks[0], yTicks[yTicks.length - 1]] : undefined}
            tickFormatter={(v: number) => `${v.toFixed(0)}°${temperatureUnit}`}
            tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            content={renderTooltip}
            cursor={{ stroke: theme.palette.divider, strokeWidth: 1 }}
          />
          {dragStart != null && dragEnd != null && (
            <ReferenceArea
              x1={Math.min(dragStart, dragEnd)}
              x2={Math.max(dragStart, dragEnd)}
              fill={theme.palette.primary.main}
              fillOpacity={0.08}
            />
          )}
          <Line
            type="monotone"
            dataKey="temp"
            name="Temperature"
            stroke={theme.palette.primary.main}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="stepAfter"
            dataKey="setpoint"
            name="Setpoint"
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
