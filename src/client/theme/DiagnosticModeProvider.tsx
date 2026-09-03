import { useCallback, useState, type ReactNode } from "react";
import { DiagnosticModeContext } from "~/client/theme/diagnosticModeContextValue";

const STORAGE_KEY = "diagnosticMode";

// Deliberately the same three-file shape as ThemeModeProvider — see "MUI
// Theme & UI Shell" in the implementation plan: a <DiagnosticOnly> wrapper
// component is the single place every diagnostic field opts in, which is
// what turns "new diagnostic fields default to living behind this toggle"
// into a structural convention rather than a per-field judgment call.
function resolveInitialMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function DiagnosticModeProvider({ children }: { children: ReactNode }) {
  const [diagnosticMode, setDiagnosticMode] =
    useState<boolean>(resolveInitialMode);

  const toggle = useCallback(() => {
    setDiagnosticMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore — toggle still works for the current session
      }
      return next;
    });
  }, []);

  return (
    <DiagnosticModeContext.Provider value={{ diagnosticMode, toggle }}>
      {children}
    </DiagnosticModeContext.Provider>
  );
}
