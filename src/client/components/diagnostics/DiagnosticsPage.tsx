import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import {
  fetchAirHandlers,
  fetchAirHandlerTickDecision,
  type AirHandler,
  type AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import { fetchZones, type Zone } from "~/client/api/zonesApi";
import { fetchFlairStatus, type FlairStatus } from "~/client/api/controlApi";
import StalenessMonitor from "~/client/components/diagnostics/StalenessMonitor";
import DegradedVentHistory from "~/client/components/diagnostics/DegradedVentHistory";
import HardwareDiagnostics from "~/client/components/diagnostics/HardwareDiagnostics";
import EquipmentFaultLog from "~/client/components/diagnostics/EquipmentFaultLog";
import FlairConnection from "~/client/components/connection/FlairConnection";

// Matches DashboardPage's own cadence — see its comment for why (the tick
// decision cache is only ever as fresh as the last real tick, so polling
// faster than the control loop's own interval shows nothing new).
const POLL_INTERVAL_MS = 15_000;

/**
 * Current-status diagnostics — see "Stage 12 — Current-Status
 * Diagnostics". Historical trend charts (per-zone temperature/position
 * over time, past degraded/fault timelines) are a deliberately deferred
 * follow-up that needs a Loki-backed data layer this app doesn't have yet;
 * every panel here is instead built from data that's already live.
 */
export default function DiagnosticsPage() {
  const [airHandlers, setAirHandlers] = useState<AirHandler[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tickDecisionsByAirHandlerId, setTickDecisionsByAirHandlerId] =
    useState<Map<string, AirHandlerTickDecision | null>>(new Map());
  const [flairStatus, setFlairStatus] = useState<FlairStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Same overlapping-refresh guard as DashboardPage's loadAll — see its
  // own comment for the race this prevents.
  const loadAllSeqRef = useRef(0);

  const loadAll = useCallback(async () => {
    const seq = ++loadAllSeqRef.current;
    const [handlers, zoneList, status] = await Promise.all([
      fetchAirHandlers(),
      fetchZones(),
      fetchFlairStatus(),
    ]);
    if (seq !== loadAllSeqRef.current) return;
    setAirHandlers(handlers);
    setZones(zoneList);
    setFlairStatus(status);

    const decisions = await Promise.all(
      handlers.map((h) => fetchAirHandlerTickDecision(h.id)),
    );
    if (seq !== loadAllSeqRef.current) return;
    setTickDecisionsByAirHandlerId(
      new Map(handlers.map((h, i) => [h.id, decisions[i]])),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAll]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ px: 2, pb: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Diagnostics
      </Typography>
      <Stack spacing={3}>
        <StalenessMonitor zones={zones} />
        <Divider />
        <DegradedVentHistory
          zones={zones}
          tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
        />
        <Divider />
        <HardwareDiagnostics
          zones={zones}
          tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
        />
        <Divider />
        <EquipmentFaultLog
          airHandlers={airHandlers}
          tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
        />
        <Divider />
        <FlairConnection flairStatus={flairStatus} />
      </Stack>
    </Container>
  );
}
