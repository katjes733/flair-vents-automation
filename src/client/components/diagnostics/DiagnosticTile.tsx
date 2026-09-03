import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export interface DiagnosticTileProps {
  label: string;
  value: string;
  caption?: string;
  status: "success" | "warning" | "error" | "default";
}

const DOT_COLOR: Record<DiagnosticTileProps["status"], string> = {
  success: "success.main",
  warning: "warning.main",
  error: "error.main",
  default: "text.disabled",
};

/**
 * One stat tile — colored status dot + label + bold value + optional
 * caption. Shared by every panel on the Diagnostics page (StalenessMonitor,
 * DegradedVentHistory, HardwareDiagnostics, EquipmentFaultLog,
 * FlairConnection) rather than each repeating the same layout. A plain
 * bordered `Box`, not `Card`/`Paper` — this app's own established
 * convention (see EventEditorDialog's room-row history) to avoid MUI's
 * per-component dark-mode elevation mismatch inside an already-elevated
 * surface.
 */
export default function DiagnosticTile({
  label,
  value,
  caption,
  status,
}: DiagnosticTileProps) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        minWidth: 140,
        flex: "1 1 140px",
      }}
    >
      <Box display="flex" alignItems="center" gap={0.75} mb={0.5}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: DOT_COLOR[status],
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Box>
      <Typography variant="body2" fontWeight={600}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </Box>
  );
}
