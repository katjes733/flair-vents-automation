import { useCallback, useMemo, useState, type ReactNode } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  ThemeModeContext,
  type ThemeMode,
} from "~/client/theme/themeModeContextValue";
import {
  lightStatusPalette,
  darkStatusPalette,
} from "~/client/theme/statusPalette";
// theme.d.ts's module augmentation (Palette.status) is picked up
// automatically by TypeScript since it's part of the program — no runtime
// import needed or possible for a .d.ts file.

const STORAGE_KEY = "theme";

// Explicit choice (localStorage) wins over the OS preference, which is only
// consulted once on first load — same resolution order and persistence key
// as wake-on-lan's own theme provider, ported per the implementation plan.
function resolveInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches)
      return "dark";
  } catch {
    // localStorage unavailable (e.g. private browsing restrictions)
  }
  return "light";
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(resolveInitialMode);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore — toggle still works for the current session
      }
      return next;
    });
  }, []);

  // The one fix worth making while porting this provider: memoized so a
  // re-render (e.g. from an unrelated context change) doesn't rebuild the
  // whole theme object on every render.
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          status: mode === "light" ? lightStatusPalette : darkStatusPalette,
        },
      }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={{ mode, toggle }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
