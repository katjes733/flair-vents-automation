import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

interface ZoomResetButtonProps {
  onClick: () => void;
  variant?: "text" | "outlined";
}

// Ported verbatim from tesla-powerwall-automation's own chart building
// blocks (see "Stage 13, Increment B" in the implementation plan).
// Positioned after the Y-axis (width=60) so it doesn't overlap axis labels.
export default function ZoomResetButton({
  onClick,
  variant = "text",
}: ZoomResetButtonProps) {
  return (
    <Box position="absolute" top={4} left={64} zIndex={1}>
      <Button
        size="small"
        variant={variant}
        onClick={onClick}
        sx={{ fontSize: 10, py: 0, minWidth: 0 }}
      >
        Reset zoom
      </Button>
    </Box>
  );
}
