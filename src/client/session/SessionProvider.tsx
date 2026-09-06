import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { SessionContext } from "~/client/session/sessionContextValue";
import {
  fetchMe,
  logout as logoutRequest,
  logoutEverywhere as logoutEverywhereRequest,
  type SessionUser,
} from "~/client/api/sessionApi";
import { setUnauthorizedHandler } from "~/client/api/httpClient";

// Resolves the logged-in user once on mount (GET /session/me) and exposes
// it app-wide — every protected page/route reads this instead of each
// re-checking auth itself. Also the one place a 401 from ANY API call
// (not just this provider's own /me fetch — a session expiring mid-use on
// some other page) gets turned into "you've been logged out, go to
// /login" — see httpClient.ts's setUnauthorizedHandler.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setUser(await fetchMe());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort — even if the network call itself fails, the local
      // session still clears and the user still ends up back at /login.
    } finally {
      setUser(null);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  // Destroys every session this login has, including this one — same
  // local-state/redirect shape as logout() above, just hitting the
  // logout-everywhere endpoint instead of the plain one.
  const logoutEverywhere = useCallback(async () => {
    try {
      await logoutEverywhereRequest();
    } catch {
      // Best-effort, same reasoning as logout() above.
    } finally {
      setUser(null);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      // Redundant (and harmless) if we're already there — avoids an
      // unnecessary extra history entry when the initial /me check itself
      // 401s while sitting on /login or mid-signup.
      const path = window.location.pathname;
      if (path !== "/login" && !path.startsWith("/signup")) {
        navigate("/login", { replace: true });
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  return (
    <SessionContext.Provider
      value={{ user, loading, refresh, logout, logoutEverywhere }}
    >
      {children}
    </SessionContext.Provider>
  );
}
