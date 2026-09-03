import { useEffect, useState } from "react";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import {
  fetchAvailableFlairZones,
  type FlairZoneOption,
} from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";

interface FlairZoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  // So this air handler's own already-assigned zone isn't shown as
  // "taken" — only relevant when editing, not creating.
  currentAirHandlerId?: string;
}

/**
 * A "pick your Flair zone by name" selector, backed by Flair's own real
 * `zones` resource (which already carries a human-friendly `name`) —
 * replaces requiring the raw zone id to already be known. See "Flair
 * Zone Picker" in the implementation plan.
 */
export default function FlairZoneSelect({
  value,
  onChange,
  currentAirHandlerId,
}: FlairZoneSelectProps) {
  const [zones, setZones] = useState<FlairZoneOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAvailableFlairZones()
      .then((result) => {
        if (!cancelled) setZones(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(extractErrorMessage(err) ?? "Couldn't load Flair zones.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <TextField
        select
        label="Flair zone"
        value=""
        disabled
        helperText="Loading Flair zones…"
        // MUI only shrinks the label when it infers the field is
        // non-empty from `value` — an empty string reads as "empty" even
        // though the Select is disabled/showing placeholder-ish content,
        // so without this the label sits centered and overlaps whatever
        // renders inside. Forced on every branch below for the same
        // reason, not just this one.
        slotProps={{ inputLabel: { shrink: true } }}
      >
        <MenuItem value="" />
      </TextField>
    );
  }

  if (error || !zones) {
    return (
      <TextField
        select
        label="Flair zone"
        value=""
        disabled
        error
        helperText={error ?? "Couldn't load Flair zones."}
        slotProps={{ inputLabel: { shrink: true } }}
      >
        <MenuItem value="" />
      </TextField>
    );
  }

  return (
    <TextField
      select
      label="Flair zone"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText="Which real Flair zone this air handler controls — leave unset to shadow only."
      slotProps={{
        // MUI's Select renders blank for an empty-string value unless
        // this is set — without it, "None (not linked yet)" would never
        // actually show once selected, even though the value is
        // correctly "".
        select: { displayEmpty: true },
        // See the loading branch above — displayEmpty renders real
        // content for value="", but the label's own shrink heuristic
        // still reads "" as empty and stays centered, overlapping it.
        inputLabel: { shrink: true },
      }}
    >
      <MenuItem value="">None (not linked yet)</MenuItem>
      {zones.map((zone) => {
        const takenByOther =
          zone.assignedAirHandlerId !== null &&
          zone.assignedAirHandlerId !== currentAirHandlerId;
        return (
          <MenuItem key={zone.id} value={zone.id} disabled={takenByOther}>
            {zone.name}
            {takenByOther
              ? ` (assigned to ${zone.assignedAirHandlerName})`
              : ""}
          </MenuItem>
        );
      })}
    </TextField>
  );
}
