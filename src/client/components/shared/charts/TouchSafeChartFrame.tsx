import Box from "@mui/material/Box";
import { ResponsiveContainer } from "recharts";
import type { ReactElement } from "react";

interface TouchSafeChartFrameProps {
  height: number;
  onDoubleClick?: () => void;
  children: ReactElement;
}

// Ported from tesla-powerwall-automation's own chart building blocks (see
// "Stage 13, Increment B" in the implementation plan). Wraps a Recharts
// chart so touch-drag (used for the tooltip crosshair and drag-to-zoom)
// doesn't get hijacked by the browser's native horizontal gestures
// (page-level swipe navigation, text selection, iOS's magnifying-glass
// loupe). `data-telemetry-chart` lets a future page-level touch handler
// detect "this gesture started on a chart" and bail out of its own
// swipe/pull handling, the same role `data-energy-chart` plays in the
// reference app — renamed since nothing here is energy-specific.
export default function TouchSafeChartFrame({
  height,
  onDoubleClick,
  children,
}: TouchSafeChartFrameProps) {
  return (
    <Box
      onDoubleClick={onDoubleClick}
      data-telemetry-chart="true"
      sx={{
        touchAction: "pan-y",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </Box>
  );
}
