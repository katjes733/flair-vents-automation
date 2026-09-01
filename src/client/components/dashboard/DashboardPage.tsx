import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import {
  fetchAirHandlers,
  fetchAirHandlerTickDecision,
  type AirHandler,
  type AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import { fetchZones, type Zone } from "~/client/api/zonesApi";
import { fetchOverrides, type ManualOverride } from "~/client/api/overridesApi";
import { fetchSettings } from "~/client/api/settingsApi";
import GlobalStatusBar from "~/client/components/dashboard/GlobalStatusBar";
import AirHandlerStatusCard from "~/client/components/dashboard/AirHandlerStatusCard";
import ZoneGrid from "~/client/components/dashboard/ZoneGrid";
import AddAirHandlerDialog from "~/client/components/dashboard/AddAirHandlerDialog";
import AddZoneDialog from "~/client/components/dashboard/AddZoneDialog";
import ZoneDetailDialog from "~/client/components/dashboard/ZoneDetailDialog";
import TickDecisionInspector from "~/client/components/dashboard/TickDecisionInspector";
import SyncZonesDialog from "~/client/components/dashboard/SyncZonesDialog";
import { DiagnosticOnly } from "~/client/components/shared/DiagnosticOnly";

// Matches the control loop's own default tick cadence (60s) — polling
// faster wouldn't show anything new, since the tick decision cache is
// only ever as fresh as the last real tick.
const POLL_INTERVAL_MS = 15_000;

export default function DashboardPage() {
  const [airHandlers, setAirHandlers] = useState<AirHandler[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [overrides, setOverrides] = useState<ManualOverride[]>([]);
  const [decisionsByAirHandlerId, setDecisionsByAirHandlerId] = useState<
    Map<string, AirHandlerTickDecision | null>
  >(new Map());
  const [controlDisarmed, setControlDisarmed] = useState(false);
  const [liveAirHandlerIds, setLiveAirHandlerIds] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);

  const [addAirHandlerOpen, setAddAirHandlerOpen] = useState(false);
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [syncingAirHandlerId, setSyncingAirHandlerId] = useState<string | null>(
    null,
  );

  const loadAll = useCallback(async () => {
    const [handlers, zoneList, overrideList, settings] = await Promise.all([
      fetchAirHandlers(),
      fetchZones(),
      fetchOverrides(),
      fetchSettings(),
    ]);
    setAirHandlers(handlers);
    setZones(zoneList);
    setOverrides(overrideList);
    setControlDisarmed(settings.control_disarmed);
    setLiveAirHandlerIds(new Set(settings.live_air_handler_ids));

    const decisions = await Promise.all(
      handlers.map((h) => fetchAirHandlerTickDecision(h.id)),
    );
    setDecisionsByAirHandlerId(
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

  const activeOverridesByZoneId = new Map(
    overrides.filter((o) => o.active).map((o) => [o.zoneId, o]),
  );

  return (
    <Container maxWidth="lg" sx={{ pb: 4 }}>
      <GlobalStatusBar controlDisarmed={controlDisarmed} onChanged={loadAll} />

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddAirHandlerOpen(true)}
        >
          Add air handler
        </Button>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={airHandlers.length === 0}
          onClick={() => setAddZoneOpen(true)}
        >
          Add zone
        </Button>
      </Box>

      {airHandlers.length === 0 && (
        <Typography color="text.secondary">
          No air handlers configured yet.
        </Typography>
      )}

      {airHandlers.map((airHandler) => {
        const decision = decisionsByAirHandlerId.get(airHandler.id) ?? null;
        const handlerZones = zones.filter(
          (z) => z.airHandlerId === airHandler.id,
        );
        const tickRecordsByZoneId = new Map(
          (decision?.zones ?? []).map((z) => [z.zone_id, z]),
        );
        return (
          <Box key={airHandler.id} sx={{ mb: 4 }}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
              <Button
                size="small"
                disabled={!airHandler.flairZoneId}
                onClick={() => setSyncingAirHandlerId(airHandler.id)}
              >
                Sync with Flair
              </Button>
            </Box>
            <AirHandlerStatusCard
              airHandler={airHandler}
              decision={decision}
              isLive={liveAirHandlerIds.has(airHandler.id)}
            />
            <DiagnosticOnly>
              <TickDecisionInspector decision={decision} />
            </DiagnosticOnly>
            <ZoneGrid
              zones={handlerZones}
              tickRecordsByZoneId={tickRecordsByZoneId}
              activeOverridesByZoneId={activeOverridesByZoneId}
              onChanged={loadAll}
              onEdit={setEditingZone}
            />
          </Box>
        );
      })}

      <AddAirHandlerDialog
        open={addAirHandlerOpen}
        onClose={() => setAddAirHandlerOpen(false)}
        onCreated={loadAll}
      />
      <AddZoneDialog
        open={addZoneOpen}
        airHandlers={airHandlers}
        onClose={() => setAddZoneOpen(false)}
        onCreated={loadAll}
      />
      <ZoneDetailDialog
        open={editingZone !== null}
        zone={editingZone}
        onClose={() => setEditingZone(null)}
        onSaved={loadAll}
      />
      {syncingAirHandlerId && (
        <SyncZonesDialog
          open
          airHandlerId={syncingAirHandlerId}
          zones={zones.filter((z) => z.airHandlerId === syncingAirHandlerId)}
          onClose={() => setSyncingAirHandlerId(null)}
          onSynced={loadAll}
        />
      )}
    </Container>
  );
}
