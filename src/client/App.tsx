import { Route, Navigate, Routes } from "react-router";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import NavMenu from "~/client/components/layout/NavMenu";
import MainContainer from "~/client/components/layout/MainContainer";
import Footer from "~/client/components/layout/Footer";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import { SessionProvider } from "~/client/session/SessionProvider";
import ProtectedRoute from "~/client/session/ProtectedRoute";
import GuestOnlyRoute from "~/client/session/GuestOnlyRoute";
import LoginPage from "~/client/components/auth/LoginPage";
import SignupPage from "~/client/components/auth/SignupPage";
import ForgotPasswordPage from "~/client/components/auth/ForgotPasswordPage";
import AcceptInvitePage from "~/client/components/auth/AcceptInvitePage";
import MembersPage from "~/client/components/members/MembersPage";
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
            <SessionProvider>
              <NavMenu />
              <MainContainer>
                <Routes>
                  <Route
                    path="/login"
                    element={
                      <GuestOnlyRoute>
                        <LoginPage />
                      </GuestOnlyRoute>
                    }
                  />
                  <Route
                    path="/signup"
                    element={
                      <GuestOnlyRoute>
                        <SignupPage />
                      </GuestOnlyRoute>
                    }
                  />
                  <Route
                    path="/accept-invite"
                    element={
                      <GuestOnlyRoute>
                        <AcceptInvitePage />
                      </GuestOnlyRoute>
                    }
                  />
                  <Route
                    path="/forgot-password"
                    element={
                      <GuestOnlyRoute>
                        <ForgotPasswordPage />
                      </GuestOnlyRoute>
                    }
                  />
                  <Route
                    path="/members"
                    element={
                      <ProtectedRoute>
                        <MembersPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <DashboardPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/schedules"
                    element={
                      <ProtectedRoute>
                        <SchedulesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/diagnostics"
                    element={
                      <ProtectedRoute>
                        <DiagnosticsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/telemetry"
                    element={
                      <ProtectedRoute>
                        <TelemetryPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute>
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/system-parameters"
                    element={
                      <ProtectedRoute>
                        <SystemParametersPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </MainContainer>
              <Footer />
            </SessionProvider>
          </NotificationProvider>
        </DisplayUnitProvider>
      </DiagnosticModeProvider>
    </ThemeModeProvider>
  );
}

export default App;
