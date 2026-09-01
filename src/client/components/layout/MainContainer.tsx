import Box from "@mui/material/Box";
import { type ReactNode } from "react";

interface MainContainerProps {
  children: ReactNode;
}

export default function MainContainer({ children }: MainContainerProps) {
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        minHeight: {
          xs: "calc(100vh - 48px - 56px)",
          sm: "calc(100vh - 64px - 56px)",
        },
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        width: "100%",
        overflowX: "hidden",
        paddingTop: { xs: "72px", sm: "88px" }, // AppBar (48/64px) + 24px breathing room
        paddingBottom: "72px", // 56px fixed footer + 16px breathing room
      }}
    >
      {children}
    </Box>
  );
}
