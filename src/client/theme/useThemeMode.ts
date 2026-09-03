import { useContext } from "react";
import { ThemeModeContext } from "~/client/theme/themeModeContextValue";

export const useThemeMode = () => useContext(ThemeModeContext);
