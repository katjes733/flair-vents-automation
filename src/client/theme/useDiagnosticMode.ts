import { useContext } from "react";
import { DiagnosticModeContext } from "~/client/theme/diagnosticModeContextValue";

export const useDiagnosticMode = () => useContext(DiagnosticModeContext);
