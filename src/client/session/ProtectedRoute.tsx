import { Navigate, useLocation } from "react-router";
import type { ReactNode } from "react";
import AuthLoadingSpinner from "~/client/session/AuthLoadingSpinner";
import { useSession } from "~/client/session/useSession";

// Every page under this app's real functionality (dashboard, schedules,
// settings, etc.) is wrapped in this — not logged in redirects to /login;
// logged in but not yet linked to an installation (mid BYO-Flair signup,
// resumed via a later login) redirects to /signup to finish that one
// remaining step, rather than showing a broken, installation-less
// dashboard.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <AuthLoadingSpinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!user.installationLinked) {
    return <Navigate to="/signup" replace />;
  }

  return <>{children}</>;
}
