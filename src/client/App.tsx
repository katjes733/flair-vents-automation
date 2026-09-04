import { Route, Navigate, Routes } from "react-router";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import NavMenu from "~/client/components/layout/NavMenu";
import MainContainer from "~/client/components/layout/MainContainer";
import Footer from "~/client/components/layout/Footer";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import DashboardPage from "~/client/components/dashboard/DashboardPage";
import SchedulesPage from "~/client/components/dashboard/SchedulesPage";
import SettingsPage from "~/client/components/settings/SettingsPage";
import SystemParametersPage from "~/client/components/settings/SystemParametersPage";
import DiagnosticsPage from "~/client/components/diagnostics/DiagnosticsPage";
import TelemetryPage from "~/client/components/telemetry/TelemetryPage";

function App() {
  return (
    <ThemeModeProvider>
      <DiagnosticModeProvider>
        <DisplayUnitProvider>
          <NotificationProvider>
            <NavMenu />
            <MainContainer>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/schedules" element={<SchedulesPage />} />
                <Route path="/diagnostics" element={<DiagnosticsPage />} />
                <Route path="/telemetry" element={<TelemetryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/system-parameters"
                  element={<SystemParametersPage />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </MainContainer>
            <Footer />
          </NotificationProvider>
        </DisplayUnitProvider>
      </DiagnosticModeProvider>
    </ThemeModeProvider>
  );
}

export default App;
