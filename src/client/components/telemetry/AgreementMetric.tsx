import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { computeAgreementMetric } from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface AgreementMetricProps {
  points: TickHistoryPoint[];
}

/**
 * The rolling shadow-mode agreement metric named in "Shadow mode (dry
 * run)" — mean absolute delta between this app's computed target and
 * Flair's actual reported position, across every vent sample in the
 * selected window. Gives "does this look reasonable" a quantitative
 * answer instead of only eyeballing the position charts tick by tick.
 */
export default function AgreementMetric({ points }: AgreementMetricProps) {
  const { meanAbsoluteDeltaPct, sampleCount } = useMemo(
    () => computeAgreementMetric(points),
    [points],
  );

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Agreement (mean |commanded − reported|)
      </Typography>
      <Typography variant="h6" fontWeight={600}>
        {meanAbsoluteDeltaPct !== null
          ? `${meanAbsoluteDeltaPct.toFixed(1)}%`
          : "—"}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {sampleCount > 0
          ? `${sampleCount} vent-ticks in this window`
          : "No vent samples in this window yet"}
      </Typography>
    </Box>
  );
}
