import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import type { ParamFieldOption } from "~/client/components/settings/systemParameterFields";

interface ParamFieldProps {
  label: string;
  description: string;
  value: string;
  isText: boolean;
  isDefault: boolean;
  defaultDisplayValue: string;
  options?: ParamFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  onChange: (raw: string) => void;
  onReset: () => void;
}

/**
 * One System Parameters row: an info tooltip, the labeled input, and a
 * reset-to-default affordance. Every one of the ~50 tunables on that page
 * shares this exact shape — this is the one place it's built, not 50
 * hand-written copies of it. `description` is shown as hover text rather
 * than an always-visible caption, deliberately — with this many fields on
 * one page, a caption under every row would overload the UI far more than
 * an on-demand tooltip does.
 */
export default function ParamField({
  label,
  description,
  value,
  isText,
  isDefault,
  defaultDisplayValue,
  options,
  min,
  max,
  step,
  onChange,
  onReset,
}: ParamFieldProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
      <Tooltip title={description}>
        <IconButton size="small" aria-label={`About ${label}`} sx={{ mt: 0.5 }}>
          <InfoOutlinedIcon fontSize="small" color="action" />
        </IconButton>
      </Tooltip>
      <TextField
        select={Boolean(options)}
        size="small"
        fullWidth
        type={options || isText ? "text" : "number"}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        slotProps={
          !options && !isText ? { htmlInput: { min, max, step } } : undefined
        }
      >
        {options?.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>
      <Tooltip title={`Reset to default (${defaultDisplayValue})`}>
        <span>
          <IconButton
            size="small"
            aria-label={`Reset ${label} to default`}
            onClick={onReset}
            disabled={isDefault}
            sx={{ mt: 0.5 }}
          >
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}
