import { Route, Navigate, Routes } from "react-router";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";
import NavMenu from "~/client/components/layout/NavMenu";
import MainContainer from "~/client/components/layout/MainContainer";
import Footer from "~/client/components/layout/Footer";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import DashboardPage from "~/client/components/dashboard/DashboardPage";

function App() {
  return (
    <ThemeModeProvider>
      <DiagnosticModeProvider>
        <NotificationProvider>
          <NavMenu />
          <MainContainer>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </MainContainer>
          <Footer />
        </NotificationProvider>
      </DiagnosticModeProvider>
    </ThemeModeProvider>
  );
}

export default App;
