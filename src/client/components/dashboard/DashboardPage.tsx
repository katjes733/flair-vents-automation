import { useCallback, useEffect, useRef, useState } from "react";
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
import { fetchSettings, updateSettings } from "~/client/api/settingsApi";
import GlobalStatusBar from "~/client/components/dashboard/GlobalStatusBar";
import AirHandlerStatusCard from "~/client/components/dashboard/AirHandlerStatusCard";
import ZoneGrid from "~/client/components/dashboard/ZoneGrid";
import AddAirHandlerDialog from "~/client/components/dashboard/AddAirHandlerDialog";
import EditAirHandlerDialog from "~/client/components/dashboard/EditAirHandlerDialog";
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
  // The real, global DRY_RUN env var value — read-only, see settingsApi's
  // own comment. Defaults true (matching the app's own fail-closed
  // default) until the first real fetch lands.
  const [globalDryRun, setGlobalDryRun] = useState(true);
  const [liveAirHandlerIds, setLiveAirHandlerIds] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);

  const [addAirHandlerOpen, setAddAirHandlerOpen] = useState(false);
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editingAirHandler, setEditingAirHandler] = useState<AirHandler | null>(
    null,
  );
  const [syncingAirHandlerId, setSyncingAirHandlerId] = useState<string | null>(
    null,
  );

  // Guards against a real, observed race: an editing action (e.g. saving
  // a zone) triggers its own immediate loadAll() on top of the recurring
  // 15s poll, and nothing stops the two from overlapping. Without this,
  // whichever call's response happens to arrive *last* wins the setState
  // calls below regardless of which one was *started* last — so a poll
  // already in flight when you hit Save can resolve after your own
  // post-save refresh and silently overwrite it with pre-save data, which
  // then only self-corrects on the next clean poll. `loadAllSeqRef` is
  // bumped at the start of every call; a call only commits its results if
  // it's still the most recently *started* one by the time its data
  // arrives — an older call finishing late is simply discarded.
  const loadAllSeqRef = useRef(0);

  const loadAll = useCallback(async () => {
    const seq = ++loadAllSeqRef.current;
    const [handlers, zoneList, overrideList, settings] = await Promise.all([
      fetchAirHandlers(),
      fetchZones(),
      fetchOverrides(),
      fetchSettings(),
    ]);
    if (seq !== loadAllSeqRef.current) return;
    setAirHandlers(handlers);
    setZones(zoneList);
    setOverrides(overrideList);
    setControlDisarmed(settings.control_disarmed);
    setLiveAirHandlerIds(new Set(settings.live_air_handler_ids));
    setGlobalDryRun(settings.dry_run);

    const decisions = await Promise.all(
      handlers.map((h) => fetchAirHandlerTickDecision(h.id)),
    );
    if (seq !== loadAllSeqRef.current) return;
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

  // Adds/removes one air handler from live_air_handler_ids, preserving
  // every other handler's own membership — AirHandlerStatusCard only knows
  // its own promoted/not-promoted slice, this is where the full array
  // actually lives. See "Manual disarm" / the DRY_RUN vs. live_air_handler_ids
  // split for why this is a separate lever from the global DRY_RUN env var.
  const handleTogglePromoted = useCallback(
    async (airHandlerId: string) => {
      const next = liveAirHandlerIds.has(airHandlerId)
        ? [...liveAirHandlerIds].filter((id) => id !== airHandlerId)
        : [...liveAirHandlerIds, airHandlerId];
      await updateSettings({ live_air_handler_ids: next });
      await loadAll();
    },
    [liveAirHandlerIds, loadAll],
  );

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
  // Every air handler's own tickRecordsByZoneId is scoped to its own
  // zones below, but ZoneDetailDialog is rendered once, globally, keyed by
  // editingZone rather than by air handler — this merges across every
  // handler's decision so the dialog can resolve editingZone's own record
  // regardless of which air handler it belongs to (each zone id is unique
  // across the whole installation, so merging is safe).
  const editingZoneTickRecord = editingZone
    ? Array.from(decisionsByAirHandlerId.values())
        .flatMap((d) => d?.zones ?? [])
        .find((z) => z.zone_id === editingZone.id)
    : undefined;

  return (
    <Container maxWidth="lg" sx={{ pb: 4 }}>
      <GlobalStatusBar controlDisarmed={controlDisarmed} onChanged={loadAll}>
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
      </GlobalStatusBar>

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
            <AirHandlerStatusCard
              airHandler={airHandler}
              decision={decision}
              isPromoted={liveAirHandlerIds.has(airHandler.id)}
              globalDryRun={globalDryRun}
              onTogglePromoted={() => handleTogglePromoted(airHandler.id)}
            >
              <Button
                size="small"
                onClick={() => setEditingAirHandler(airHandler)}
              >
                Edit
              </Button>
              <Button
                size="small"
                disabled={!airHandler.flairZoneId}
                onClick={() => setSyncingAirHandlerId(airHandler.id)}
              >
                Sync with Flair
              </Button>
            </AirHandlerStatusCard>
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
      <EditAirHandlerDialog
        open={editingAirHandler !== null}
        airHandler={editingAirHandler}
        onClose={() => setEditingAirHandler(null)}
        onSaved={loadAll}
        onDeleted={loadAll}
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
        tickRecord={editingZoneTickRecord}
        onClose={() => setEditingZone(null)}
        onSaved={loadAll}
        onDeleted={loadAll}
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
