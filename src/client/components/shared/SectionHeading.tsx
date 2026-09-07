import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

interface SectionHeadingProps {
  title: string;
  description: string;
  variant?: "subtitle2" | "caption";
  sx?: object;
}

/**
 * A section title + an info tooltip explaining what it means and when it
 * actually triggers — the same info-icon-on-hover pattern ParamField
 * already uses for System Parameters' ~50 tunables, applied to every
 * titled panel on the Diagnostics/Telemetry pages instead. Raised
 * directly after a real question ("why didn't Spike Detection catch
 * this?") that a one-line tooltip would have answered without needing to
 * ask — every diagnostic section gets the same treatment now, not just
 * the one that prompted it.
 */
export default function SectionHeading({
  title,
  description,
  variant = "subtitle2",
  sx,
}: SectionHeadingProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, ...sx }}>
      <Typography variant={variant} color="text.secondary">
        {title}
      </Typography>
      <Tooltip title={description}>
        <IconButton size="small" aria-label={`About ${title}`} sx={{ p: 0.25 }}>
          <InfoOutlinedIcon
            sx={{ fontSize: variant === "caption" ? 14 : 16 }}
            color="action"
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
