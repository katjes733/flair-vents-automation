import { createContext } from "react";

export type ThemeMode = "light" | "dark";

export interface ThemeModeContextValue {
  mode: ThemeMode;
  toggle: () => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: "light",
  toggle: () => {},
});
