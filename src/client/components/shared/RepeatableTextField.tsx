import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";

interface RepeatableTextFieldProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
}

/**
 * Add/remove-row text input — no existing reusable pattern fit this
 * (zone_priority_order/away_native_zone_ids are checkbox-selected from an
 * already-fetched entity list; Flair vent ids aren't drawn from any list
 * this app has). Used for zone.config.flair_vent_ids. See "Multi-Vent
 * Zones" in the implementation plan.
 */
export default function RepeatableTextField({
  label,
  values,
  onChange,
  addLabel,
}: RepeatableTextFieldProps) {
  const handleRowChange = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };
  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };
  const handleAdd = () => {
    onChange([...values, ""]);
  };

  return (
    <Stack spacing={1}>
      {values.map((value, index) => (
        <Box key={index} sx={{ display: "flex", gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            label={`${label} ${index + 1}`}
            value={value}
            onChange={(e) => handleRowChange(index, e.target.value)}
          />
          <IconButton
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => handleRemove(index)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={handleAdd}>
        {addLabel}
      </Button>
    </Stack>
  );
}
