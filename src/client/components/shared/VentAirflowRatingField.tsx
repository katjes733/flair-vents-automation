import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import { toDisplayFlowRate, type AirflowUnit } from "~/shared/types/airflow";
import {
  VENT_SIZES,
  VENT_SIZE_RATED_FLOW_RATE_LPS,
  type VentSize,
} from "~/shared/types/ventSize";

interface VentAirflowRatingFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  airflowUnit: AirflowUnit;
}

// Reverse-lookup a vent size from an already-set rating, so a zone that
// was previously rated via the size picker still shows its size after a
// remount (e.g. closing and reopening the edit dialog) instead of
// reverting to blank. Compared at the same 1-decimal precision the picker
// itself writes with (see the onChange handler below and
// ZoneDetailDialog's own identical `.toFixed(1)` seeding), so a size's
// rating round-trips exactly; a rating that was hand-typed or edited away
// from any size's rated value correctly resolves to no match.
function findMatchingVentSize(
  value: string,
  airflowUnit: AirflowUnit,
): VentSize | "" {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) return "";
  return (
    VENT_SIZES.find(
      (size) =>
        toDisplayFlowRate(
          VENT_SIZE_RATED_FLOW_RATE_LPS[size],
          airflowUnit,
        ).toFixed(1) === parsed.toFixed(1),
    ) ?? ""
  );
}

/**
 * A "Vent size" picker (sourced ratings — see
 * docs/hvac-pressure-research.md's "Register Size to Airflow Rating") sits
 * next to the raw airflow-rating field and, on selection, fills that field
 * with the size's rated max flow — converted to whatever unit the viewer
 * currently prefers. It's a one-shot autofill, not a second source of
 * truth for the actual submitted rating (that's always the plain number
 * field beside it, freely editable afterward — a real house's actual
 * register may not match its nominal size's rated capacity exactly, which
 * is the whole reason this stays an override, not a locked-in mapping).
 * The picker's own *displayed* selection is local, UI-only state, kept
 * purely so a user can see which size is currently in effect rather than
 * the control showing a blank placeholder — seeded (and kept in sync) by
 * reverse-looking-up the current rating against every size's own rated
 * value, so it's correctly populated both right after a pick and after a
 * remount (e.g. closing and reopening the dialog). A rating that doesn't
 * match any size's rated value (hand-typed, or edited away from one)
 * correctly shows no size selected.
 *
 * Both controls are fixed-width, not flex-grown — an airflow rating is a
 * short number (this app's own sanity bound tops out at 944, i.e. at most
 * 3 digits plus one decimal), so the field only needs to be as wide as
 * that plus its own label, not stretched to fill whatever space a caller
 * happens to have. Letting every vent-row control size itself to its real
 * content, instead of expanding to fill the row, is what keeps the row —
 * and the dialog around it, since the row is the widest thing in it —
 * genuinely narrow.
 */
export default function VentAirflowRatingField({
  label,
  value,
  onChange,
  airflowUnit,
}: VentAirflowRatingFieldProps) {
  const [selectedSize, setSelectedSize] = useState<VentSize | "">(() =>
    findMatchingVentSize(value, airflowUnit),
  );

  useEffect(() => {
    setSelectedSize(findMatchingVentSize(value, airflowUnit));
  }, [value, airflowUnit]);

  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      <TextField
        select
        size="small"
        label="Vent size"
        value={selectedSize}
        sx={{ width: 110 }}
        onChange={(e) => {
          const size = e.target.value as VentSize;
          setSelectedSize(size);
          const ratedLps = VENT_SIZE_RATED_FLOW_RATE_LPS[size];
          onChange(toDisplayFlowRate(ratedLps, airflowUnit).toFixed(1));
        }}
      >
        {VENT_SIZES.map((size) => (
          <MenuItem key={size} value={size}>
            {size}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        type="number"
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ width: 120 }}
      />
    </Box>
  );
}
