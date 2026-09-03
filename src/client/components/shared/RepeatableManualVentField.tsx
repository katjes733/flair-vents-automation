import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import VentAirflowRatingField from "~/client/components/shared/VentAirflowRatingField";
import { AIRFLOW_UNIT_LABELS, type AirflowUnit } from "~/shared/types/airflow";

export interface ManualVentRow {
  position: string;
  ductFlowRateLps: string;
}

interface RepeatableManualVentFieldProps {
  values: ManualVentRow[];
  onChange: (values: ManualVentRow[]) => void;
  airflowUnit: AirflowUnit;
}

/**
 * Add/remove-row input for a manual_fixed_vent zone's own vents — each with
 * its own position and (optional) duct rating, since a real house confirmed
 * two vents in the same room can genuinely sit at different open amounts.
 * Mirrors RepeatableTextField's add/remove shape, but a plain string list
 * doesn't fit here: each row needs two independent values, not one. See
 * "Multi-Vent Manual Zones".
 *
 * Every control in a row is sized to its actual content (fixed widths,
 * not flex-grown to fill the row) — a position is a 0–100 number, so its
 * field is only as wide as a short label and three digits need, not
 * stretched to match whatever room the dialog happens to have. Confirmed
 * live: an earlier flex-based version left the position field's own label
 * clipped and made the whole row (and the dialog around it, since this
 * row is the widest thing in it) wider than it needed to be.
 */
export default function RepeatableManualVentField({
  values,
  onChange,
  airflowUnit,
}: RepeatableManualVentFieldProps) {
  const handlePositionChange = (index: number, value: string) => {
    const next = [...values];
    next[index] = { ...next[index], position: value };
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
  const handleAdd = () => {
    onChange([...values, { position: "", ductFlowRateLps: "" }]);
  };

  return (
    <Stack spacing={1}>
      {values.map((row, index) => (
        <Box
          key={index}
          sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}
        >
          <TextField
            size="small"
            type="number"
            label={`Position ${index + 1}`}
            value={row.position}
            onChange={(e) => handlePositionChange(index, e.target.value)}
            sx={{ width: 106 }}
          />
          <VentAirflowRatingField
            label={`Rating ${index + 1}, ${AIRFLOW_UNIT_LABELS[airflowUnit]}`}
            value={row.ductFlowRateLps}
            onChange={(value) => handleDuctChange(index, value)}
            airflowUnit={airflowUnit}
          />
          <IconButton
            aria-label={`Remove vent ${index + 1}`}
            onClick={() => handleRemove(index)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={handleAdd}>
        Add another vent
      </Button>
    </Stack>
  );
}
