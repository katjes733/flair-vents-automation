import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";

interface TickDecisionInspectorProps {
  decision: AirHandlerTickDecision | null;
}

/**
 * The in-app answer to "what did the system just decide, and why," per
 * "Comprehensive tick decision record" in the implementation plan —
 * everything from one GET /air-handlers/:id/tick-decision call, no Grafana
 * needed. Diagnostic-Mode-only, per <DiagnosticOnly>'s convention.
 */
export default function TickDecisionInspector({
  decision,
}: TickDecisionInspectorProps) {
  if (!decision) return null;

  return (
    <Accordion
      variant="outlined"
      sx={{ mb: 2 }}
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">Tick decision inspector</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" sx={{ mb: 2, fontStyle: "italic" }}>
          {decision.narrative}
        </Typography>

        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Zone</TableCell>
                <TableCell>Vent</TableCell>
                <TableCell>Classification</TableCell>
                <TableCell align="right">Desired</TableCell>
                <TableCell align="right">Post-contention</TableCell>
                <TableCell align="right">Commanded</TableCell>
                <TableCell align="right">Reported</TableCell>
                <TableCell>Dispatch</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {decision.zones.flatMap((z) =>
                z.vents.length > 0 ? (
                  z.vents.map((v) => (
                    <TableRow key={`${z.zone_id}:${v.flair_vent_id}`}>
                      <TableCell>{z.name}</TableCell>
                      <TableCell>{v.flair_vent_id}</TableCell>
                      <TableCell>{z.classification}</TableCell>
                      <TableCell align="right">
                        {z.desired_position_pct ?? "—"}
                      </TableCell>
                      <TableCell align="right">
                        {z.post_contention_position_pct ?? "—"}
                      </TableCell>
                      <TableCell align="right">
                        {v.commanded_position_pct ?? "—"}
                      </TableCell>
                      <TableCell align="right">
                        {v.reported_position_pct ?? "—"}
                      </TableCell>
                      <TableCell>
                        {v.dispatch_decision}
                        {v.degraded ? " (degraded)" : ""}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow key={z.zone_id}>
                    <TableCell>{z.name}</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>{z.classification}</TableCell>
                    <TableCell align="right">
                      {z.desired_position_pct ?? "—"}
                    </TableCell>
                    <TableCell align="right">
                      {z.post_contention_position_pct ?? "—"}
                    </TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell>not_applicable_no_vent</TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {decision.pressure && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                Pressure
              </Typography>
              <Typography variant="body2">
                {decision.pressure.aggregate_open_lps.toFixed(0)} L/s (
                {decision.pressure.aggregate_open_pct.toFixed(0)}%) · floor{" "}
                {decision.pressure.floor_lps.toFixed(0)} L/s
                {decision.pressure.clamped && " · CLAMPED"}
              </Typography>
            </Box>
          )}
          {decision.driving_zone && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                Driving zone
              </Typography>
              <Typography variant="body2">
                {decision.zones.find(
                  (z) => z.zone_id === decision.driving_zone?.zone_id,
                )?.name ?? "none"}{" "}
                ({decision.driving_zone.reason.replace(/_/g, " ")})
              </Typography>
            </Box>
          )}
          {decision.setpoint_push && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                Setpoint push
              </Typography>
              <Typography variant="body2">
                {decision.setpoint_push.pushed_value?.toFixed(1) ?? "—"}°C
                {decision.setpoint_push.would_write
                  ? " (written)"
                  : " (not written)"}
                {" · thermostat "}
                {decision.setpoint_push.thermostat_reading?.toFixed(1) ?? "—"}°C
                {" · "}
                {decision.setpoint_push.demanding_zone_count} demanding
              </Typography>
            </Box>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
