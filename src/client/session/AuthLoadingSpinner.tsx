import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

// Shared by ProtectedRoute and GuestOnlyRoute for the one shared moment
// both need to render identically — the initial GET /session/me still in
// flight, before either guard can know which way to route.
export default function AuthLoadingSpinner() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
        pt: 8,
      }}
    >
      <CircularProgress />
    </Box>
  );
}
