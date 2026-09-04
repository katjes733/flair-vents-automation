import { useCallback, useMemo } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
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
import { buildOpenCapacityData } from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface OpenCapacityChartProps {
  points: TickHistoryPoint[];
  height?: number;
}

// Aggregate open-area percentage over time, with the pressure-safeguard cap
// as a reference line — see "Stage 13, Increment B" and "Pressure
// safeguard" in the implementation plan.
export default function OpenCapacityChart({
  points,
  height = 200,
}: OpenCapacityChartProps) {
  const theme = useTheme();

  const data = useMemo(() => buildOpenCapacityData(points), [points]);

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

  const capPct = useMemo(() => {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].capPct !== null) return data[i].capPct;
    }
    return null;
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
      const openEntry = payload.find((p) => p.dataKey === "openPct");
      if (openEntry?.value != null) {
        rows.push({
          label: "Open",
          value: `${openEntry.value.toFixed(0)}%`,
          color: theme.palette.primary.main,
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
          <defs>
            <linearGradient id="ocg-open" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={theme.palette.primary.main}
                stopOpacity={0.35}
              />
              <stop
                offset="100%"
                stopColor={theme.palette.primary.main}
                stopOpacity={0.05}
              />
            </linearGradient>
          </defs>
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
          {capPct !== null && (
            <ReferenceLine
              y={capPct}
              stroke={theme.palette.warning.main}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: "Cap",
                position: "insideTopRight",
                fill: theme.palette.warning.main,
                fontSize: 10,
              }}
            />
          )}
          {dragStart != null && dragEnd != null && (
            <ReferenceArea
              x1={Math.min(dragStart, dragEnd)}
              x2={Math.max(dragStart, dragEnd)}
              fill={theme.palette.primary.main}
              fillOpacity={0.08}
            />
          )}
          <Area
            type="monotone"
            dataKey="openPct"
            name="Open"
            stroke={theme.palette.primary.main}
            strokeWidth={1.5}
            fill="url(#ocg-open)"
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </TouchSafeChartFrame>
    </Box>
  );
}
