import { Navigate } from "react-router";
import type { ReactNode } from "react";
import AuthLoadingSpinner from "~/client/session/AuthLoadingSpinner";
import { useSession } from "~/client/session/useSession";

// Wraps /login and /signup — redirects a fully signed-in user straight to
// the dashboard rather than showing them a login/signup form again.
// Deliberately does NOT redirect a user who's logged in but not yet linked
// to an installation (installationLinked: false) — that's exactly the
// resumed-mid-signup case /signup itself needs to keep rendering for.
export default function GuestOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();

  if (loading) return <AuthLoadingSpinner />;

  if (user?.installationLinked) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
