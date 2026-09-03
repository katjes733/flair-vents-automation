import Box from "@mui/material/Box";

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        position: "fixed",
        left: 0,
        bottom: 0,
        width: "100%",
        textAlign: "center",
        py: 2,
        fontSize: "0.9rem",
        color: "text.secondary",
        bgcolor: "background.paper",
        zIndex: (theme) => theme.zIndex.appBar - 1,
        boxShadow: 1,
      }}
    >
      &copy; 2026 Katjes (Martin Macecek). Flair Vents Automation.
    </Box>
  );
}
