import { createContext } from "react";

export interface DiagnosticModeContextValue {
  diagnosticMode: boolean;
  toggle: () => void;
}

export const DiagnosticModeContext = createContext<DiagnosticModeContextValue>({
  diagnosticMode: false,
  toggle: () => {},
});
