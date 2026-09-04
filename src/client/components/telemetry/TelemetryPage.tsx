import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import {
  fetchAirHandlers,
  type AirHandler,
  type AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import { fetchZones, type Zone } from "~/client/api/zonesApi";
import { useTickHistory } from "~/client/components/telemetry/useTickHistory";
import { useOverrideHistory } from "~/client/components/telemetry/useOverrideHistory";
import OverrideActivityLane from "~/client/components/telemetry/OverrideActivityLane";
import ZoneTemperatureChart from "~/client/components/telemetry/ZoneTemperatureChart";
import VentPositionChart from "~/client/components/telemetry/VentPositionChart";
import HvacStateTimeline from "~/client/components/telemetry/HvacStateTimeline";
import OpenCapacityChart from "~/client/components/telemetry/OpenCapacityChart";
import SpikeEventTimeline from "~/client/components/telemetry/SpikeEventTimeline";
import AgreementMetric from "~/client/components/telemetry/AgreementMetric";
import DegradedVentHistory from "~/client/components/diagnostics/DegradedVentHistory";
import EquipmentFaultLog from "~/client/components/diagnostics/EquipmentFaultLog";

const RANGE_OPTIONS = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
];

/**
 * Stage 13, Increment B's historical view — every chart here is derived
 * from `Control tick decision`'s own Loki-retained history via
 * `useTickHistory`, which only exists once this app has actually been
 * deployed for a while and Loki has real ticks to serve back. See
 * DiagnosticsPage for the current-status counterpart, which has no Loki
 * dependency at all.
 */
export default function TelemetryPage() {
  const [airHandlers, setAirHandlers] = useState<AirHandler[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedAirHandlerId, setSelectedAirHandlerId] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [rangeHours, setRangeHours] = useState(24);
  const [range, setRange] = useState(() => {
    const toMs = Date.now();
    return { fromMs: toMs - 24 * 3600 * 1000, toMs };
  });

  useEffect(() => {
    Promise.all([fetchAirHandlers(), fetchZones()]).then(([ahs, zs]) => {
      setAirHandlers(ahs);
      setZones(zs);
      setSelectedAirHandlerId(
        (cur) => cur || (ahs.length > 0 ? ahs[0].id : ""),
      );
    });
  }, []);

  const zonesForHandler = useMemo(
    () => zones.filter((z) => z.airHandlerId === selectedAirHandlerId),
    [zones, selectedAirHandlerId],
  );

  useEffect(() => {
    if (zonesForHandler.length === 0) {
      setSelectedZoneId("");
      return;
    }
    setSelectedZoneId((cur) =>
      zonesForHandler.some((z) => z.id === cur) ? cur : zonesForHandler[0].id,
    );
  }, [zonesForHandler]);

  useEffect(() => {
    const toMs = Date.now();
    setRange({ fromMs: toMs - rangeHours * 3600 * 1000, toMs });
  }, [rangeHours, selectedAirHandlerId]);

  const { points, loading, unavailable, error, refetch } = useTickHistory(
    selectedAirHandlerId || null,
    range.fromMs,
    range.toMs,
  );

  const { overrides, refetch: refetchOverrides } = useOverrideHistory(
    selectedZoneId || null,
    range.fromMs,
    range.toMs,
  );

  const handleRefresh = () => {
    const toMs = Date.now();
    setRange({ fromMs: toMs - rangeHours * 3600 * 1000, toMs });
    refetch();
    refetchOverrides();
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedAirHandler =
    airHandlers.find((ah) => ah.id === selectedAirHandlerId) ?? null;
  const emptyTickDecisionMap = useMemo(
    () => new Map<string, AirHandlerTickDecision | null>(),
    [],
  );
  const latestDecisionZone = useMemo(() => {
    if (points.length === 0 || !selectedZoneId) return null;
    return (
      points[points.length - 1].decision.zones.find(
        (z) => z.zone_id === selectedZoneId,
      ) ?? null
    );
  }, [points, selectedZoneId]);

  return (
    <Container maxWidth="md" sx={{ px: 2, pb: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Telemetry
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, flexWrap: "wrap" }}
        alignItems="center"
      >
        <TextField
          select
          label="Air handler"
          size="small"
          value={selectedAirHandlerId}
          onChange={(e) => setSelectedAirHandlerId(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          {airHandlers.map((ah) => (
            <MenuItem key={ah.id} value={ah.id}>
              {ah.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Zone"
          size="small"
          value={selectedZoneId}
          onChange={(e) => setSelectedZoneId(e.target.value)}
          disabled={zonesForHandler.length === 0}
          sx={{ minWidth: 180 }}
        >
          {zonesForHandler.map((z) => (
            <MenuItem key={z.id} value={z.id}>
              {z.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Range"
          size="small"
          value={rangeHours}
          onChange={(e) => setRangeHours(Number(e.target.value))}
          sx={{ minWidth: 150 }}
        >
          {RANGE_OPTIONS.map((r) => (
            <MenuItem key={r.hours} value={r.hours}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="outlined" onClick={handleRefresh}>
          Refresh
        </Button>
        {loading && <CircularProgress size={20} />}
      </Stack>

      {unavailable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Historical telemetry is not available — LOKI_URL is not configured for
          this deployment. See env/sample.remote.env.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!unavailable && !error && !loading && points.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Loki is configured, but nothing has been logged for this air handler
          in the selected window yet.
        </Alert>
      )}

      {!unavailable && points.length > 0 && (
        <Stack spacing={3}>
          <Box>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              Air Handler
            </Typography>
            <Stack spacing={2}>
              <HvacStateTimeline points={points} />
              <OpenCapacityChart points={points} />
              <AgreementMetric points={points} />
              <EquipmentFaultLog
                airHandlers={[]}
                tickDecisionsByAirHandlerId={emptyTickDecisionMap}
                historyPoints={points}
                historyAirHandlerId={selectedAirHandlerId}
                historyAirHandlerName={selectedAirHandler?.name}
                hideCurrentStatus
              />
              <DegradedVentHistory
                zones={zonesForHandler}
                tickDecisionsByAirHandlerId={emptyTickDecisionMap}
                historyPoints={points}
                hideCurrentStatus
              />
            </Stack>
          </Box>

          {selectedZone && (
            <>
              <Divider />
              <Box>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  {selectedZone.name}
                </Typography>
                <Stack spacing={2}>
                  <ZoneTemperatureChart
                    points={points}
                    zoneId={selectedZone.id}
                  />
                  <SpikeEventTimeline
                    points={points}
                    zoneId={selectedZone.id}
                  />
                  <OverrideActivityLane
                    overrides={overrides}
                    domain={[range.fromMs, range.toMs]}
                  />
                  {selectedZone.config.flair_vents.map((v, i) => (
                    <Box key={v.flair_vent_id}>
                      <Typography variant="caption" color="text.secondary">
                        {latestDecisionZone?.vents.find(
                          (dv) => dv.flair_vent_id === v.flair_vent_id,
                        )?.name || `Vent ${i + 1}`}
                      </Typography>
                      <VentPositionChart
                        points={points}
                        zoneId={selectedZone.id}
                        flairVentId={v.flair_vent_id}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      )}
    </Container>
  );
}
