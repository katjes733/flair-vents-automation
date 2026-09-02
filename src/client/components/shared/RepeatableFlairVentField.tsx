import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import VentAirflowRatingField from "~/client/components/shared/VentAirflowRatingField";
import { AIRFLOW_UNIT_LABELS, type AirflowUnit } from "~/shared/types/airflow";

export interface FlairVentRow {
  flairVentId: string;
  ductFlowRateLps: string;
}

interface RepeatableFlairVentFieldProps {
  values: FlairVentRow[];
  onChange: (values: FlairVentRow[]) => void;
  airflowUnit: AirflowUnit;
  // The vent's own Flair-app nickname, keyed by its raw id, from the
  // latest tick decision — displayed in place of the raw id whenever
  // it's known, mirroring how ZoneCard/TickDecisionInspector already
  // prefer a vent's real nickname over its id everywhere else. See
  // "Raw IDs Leaking Into the UI".
  ventNameByFlairVentId?: Map<string, string>;
  // Whether the Flair vent id itself can be typed/edited. True for
  // AddZoneDialog (creating a brand-new zone, where there's no existing
  // vent data yet to resolve identity from — the raw id is the only
  // thing a user could possibly enter). False for ZoneDetailDialog: a
  // vent's identity should only ever come from "Sync with Flair," never
  // hand-edited, so the id itself is never shown at all — only its real
  // nickname (or an ordinal fallback), displayed read-only.
  idEditable: boolean;
}

/**
 * Add/remove-row input for a flair_smart_vent zone's own vents — each with
 * its own Flair vent id and (optional) duct rating. Every vent in the zone
 * is still commanded to the same ganged target position (unchanged — see
 * "Multi-Vent Zones"); what changed is that the zone's airflow rating used
 * to be one manually-summed combined number, and is now entered per vent
 * instead, mirroring RepeatableManualVentField's identical shape. See
 * "Multi-Vent Manual Zones" for why per-vent ratings were extended from
 * manual vents to smart vents.
 *
 * Deliberately has no "Add another vent" affordance, unlike its manual-vent
 * sibling — a Flair vent's id is Flair's own opaque identifier, not
 * something a user would ever type from memory the way a manual vent's
 * physical position is. The real, reliable way to add a vent to an
 * already-linked zone is re-running "Sync with Flair", which picks up a
 * newly-paired vent's real id automatically (see the Flair Sync Engine's
 * matched_vent_set_changed handling) — manual entry here exists only for
 * the one id a user might already know at zone-creation time, not for
 * building up a multi-vent set by hand.
 */
export default function RepeatableFlairVentField({
  values,
  onChange,
  airflowUnit,
  ventNameByFlairVentId,
  idEditable,
}: RepeatableFlairVentFieldProps) {
  const handleIdChange = (index: number, value: string) => {
    const next = [...values];
    next[index] = { ...next[index], flairVentId: value };
    onChange(next);
  };
  const handleDuctChange = (index: number, value: string) => {
    const next = [...values];
    next[index] = { ...next[index], ductFlowRateLps: value };
    onChange(next);
  };
  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <Stack spacing={1}>
      {values.map((row, index) => {
        const nickname = ventNameByFlairVentId?.get(row.flairVentId);
        return (
          <Box
            key={index}
            sx={{ display: "flex", gap: 1, alignItems: "center" }}
          >
            {idEditable ? (
              <TextField
                size="small"
                label={nickname || `Flair vent ID ${index + 1}`}
                value={row.flairVentId}
                onChange={(e) => handleIdChange(index, e.target.value)}
                sx={{ width: 140 }}
              />
            ) : (
              // Fixed at the widest value that still fits this row within
              // the dialog's existing width (measured live: the row's
              // other controls plus gaps leave exactly this much room) —
              // any nickname longer than this still wraps onto a second
              // line rather than growing the dialog.
              <Typography
                variant="body2"
                sx={{ width: 106, flexShrink: 0 }}
              >
                {nickname || `Vent ${index + 1}`}
              </Typography>
            )}
            <VentAirflowRatingField
              label={`Rating ${index + 1}, ${AIRFLOW_UNIT_LABELS[airflowUnit]}`}
              value={row.ductFlowRateLps}
              onChange={(value) => handleDuctChange(index, value)}
              airflowUnit={airflowUnit}
            />
            <IconButton
              aria-label={`Remove flair vent id ${index + 1}`}
              onClick={() => handleRemove(index)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      <Typography variant="caption" color="text.secondary">
        A newly-paired vent's id is picked up automatically via "Sync with
        Flair" — this list isn't meant to be built up by hand.
      </Typography>
    </Stack>
  );
}
