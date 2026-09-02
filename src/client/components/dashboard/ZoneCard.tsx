import { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { isZoneDegraded, type Zone } from "~/client/api/zonesApi";
import type { ZoneTickDecisionRecord } from "~/client/api/airHandlersApi";
import type { ManualOverride } from "~/client/api/overridesApi";
import { revokeOverride } from "~/client/api/overridesApi";
import { DiagnosticOnly } from "~/client/components/shared/DiagnosticOnly";
import { useTheme } from "@mui/material/styles";
import { useNotification } from "~/client/components/notification/useNotification";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { asAbsoluteTemp, toDisplayAbsolute } from "~/shared/types/temperature";
import ZoneOverrideDialog from "~/client/components/dashboard/ZoneOverrideDialog";

interface ZoneCardProps {
  zone: Zone;
  tickRecord: ZoneTickDecisionRecord | undefined;
  activeOverride: ManualOverride | undefined;
  onChanged: () => void;
  onEdit: (zone: Zone) => void;
  // Reorder affordance, rendered inline in the card's own header — not a
  // separate row, per the point of the feature (more cards visible, not
  // fewer). Omitted entirely (no props passed) when the caller doesn't
  // support reordering, e.g. in tests that only exercise the card itself.
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  satisfied: "Satisfied",
  demanding: "Demanding",
  stale: "Stale reading",
  inactive: "Inactive",
  unclassified_no_sensor: "No sensor",
};

export default function ZoneCard({
  zone,
  tickRecord,
  activeOverride,
  onChanged,
  onEdit,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: ZoneCardProps) {
  const reorderable = onMoveUp !== undefined || onMoveDown !== undefined;
  const theme = useTheme();
  const { temperatureUnit } = useDisplayUnit();
  const { showNotification } = useNotification();
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const isControllable = zone.ventHardwareType === "flair_smart_vent";

  const classification = tickRecord?.classification;
  const classificationColor =
    classification === "satisfied"
      ? theme.palette.status.satisfied
      : classification === "demanding"
        ? theme.palette.status.demanding
        : classification === "stale"
          ? theme.palette.status.staleReading
          : undefined;

  const handleRevoke = async () => {
    if (!activeOverride) return;
    try {
      await revokeOverride(activeOverride.id);
      showNotification("Override cleared.", "success");
      onChanged();
    } catch {
      showNotification("Couldn't clear the override — try again.", "error");
    }
  };

  return (
    <Card variant="outlined" sx={{ width: "100%" }}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1,
            gap: 0.5,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
            {reorderable && (
              <>
                <DragIndicatorIcon
                  fontSize="small"
                  aria-hidden
                  sx={{ color: "text.disabled", cursor: "grab" }}
                />
                <IconButton
                  size="small"
                  aria-label={`Move ${zone.name} up`}
                  disabled={!canMoveUp}
                  onClick={onMoveUp}
                  sx={{ p: 0.25 }}
                >
                  <ArrowUpwardIcon fontSize="inherit" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Move ${zone.name} down`}
                  disabled={!canMoveDown}
                  onClick={onMoveDown}
                  sx={{ p: 0.25 }}
                >
                  <ArrowDownwardIcon fontSize="inherit" />
                </IconButton>
              </>
            )}
            <Typography variant="subtitle1" fontWeight={600}>
              {zone.name}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {isZoneDegraded(zone.state) && (
              <Chip
                label="Degraded vent"
                size="small"
                sx={{
                  bgcolor: theme.palette.status.degradedVent,
                  color: "#fff",
                }}
              />
            )}
            {zone.state.stale && (
              <Chip
                label="Stale reading"
                size="small"
                sx={{
                  bgcolor: theme.palette.status.staleReading,
                  color: "#fff",
                }}
              />
            )}
            {zone.state.spike_active && (
              <Chip
                label="Spiking"
                size="small"
                sx={{ bgcolor: theme.palette.status.spiking, color: "#fff" }}
              />
            )}
            {activeOverride && (
              <Chip
                label="Manual override"
                size="small"
                sx={{
                  bgcolor: theme.palette.status.manualOverride,
                  color: "#fff",
                }}
              />
            )}
          </Box>
        </Box>

        {!isControllable && zone.ventHardwareType === "manual_fixed_vent" && (
          <Box>
            {zone.config.manual_vents.length > 1 ? (
              zone.config.manual_vents.map((v, i) => (
                <Typography key={i} variant="body2" color="text.secondary">
                  {`Manual fixed vent (Vent ${i + 1}): ${v.position}%`}
                </Typography>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                {`Manual fixed vent (${zone.config.manual_vents[0]?.position ?? "?"}%)`}
              </Typography>
            )}
          </Box>
        )}
        {!isControllable && zone.ventHardwareType === "no_vent" && (
          <Typography variant="body2" color="text.secondary">
            No vent — readings only
          </Typography>
        )}

        {zone.config.has_temperature_sensor && (
          <Box
            sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.5 }}
          >
            <Typography variant="h5">
              {zone.state.last_reading_value !== null
                ? `${toDisplayAbsolute(asAbsoluteTemp(zone.state.last_reading_value), temperatureUnit).toFixed(1)}°${temperatureUnit}`
                : "—"}
            </Typography>
            {classification && (
              <Chip
                label={CLASSIFICATION_LABELS[classification] ?? classification}
                size="small"
                sx={
                  classificationColor
                    ? { bgcolor: classificationColor, color: "#fff" }
                    : undefined
                }
              />
            )}
          </Box>
        )}

        {isControllable && tickRecord && tickRecord.vents.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            {tickRecord.vents.map((v, i) => (
              <Box key={v.flair_vent_id} sx={{ mb: 0.5 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 0.5,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {tickRecord.vents.length > 1
                      ? `Vent position (${v.name || `Vent ${i + 1}`})`
                      : "Vent position"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {v.commanded_position_pct ?? 0}% commanded
                    {v.reported_position_pct !== null &&
                      ` · ${v.reported_position_pct}% reported`}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={v.commanded_position_pct ?? 0}
                />
              </Box>
            ))}
          </Box>
        )}

        <DiagnosticOnly>
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
            >
              Desired {tickRecord?.desired_position_pct ?? "—"}% ·
              Post-contention {tickRecord?.post_contention_position_pct ?? "—"}%
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
            >
              Occupied: {tickRecord?.occupied ? "yes" : "no"} · Reconcile
              attempts:{" "}
              {Math.max(
                0,
                ...zone.state.vents.map((v) => v.reconcile_attempts),
              )}
            </Typography>
            {tickRecord?.reason && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                {tickRecord.reason}
              </Typography>
            )}
          </Box>
        </DiagnosticOnly>

        <Box sx={{ mt: 1.5, display: "flex", gap: 1 }}>
          <Button size="small" onClick={() => onEdit(zone)}>
            Edit
          </Button>
          {isControllable &&
            (activeOverride ? (
              <Button size="small" onClick={handleRevoke}>
                Clear override
              </Button>
            ) : (
              <Button size="small" onClick={() => setOverrideDialogOpen(true)}>
                Set manual override
              </Button>
            ))}
        </Box>
      </CardContent>

      <ZoneOverrideDialog
        open={overrideDialogOpen}
        zoneId={zone.id}
        zoneName={zone.name}
        onClose={() => setOverrideDialogOpen(false)}
        onCreated={onChanged}
      />
    </Card>
  );
}
