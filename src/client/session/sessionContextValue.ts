import { createContext } from "react";
import type { SessionUser } from "~/client/api/sessionApi";

export interface SessionContextValue {
  user: SessionUser | null;
  // true until the initial GET /session/me resolves — distinct from
  // user === null, which means "resolved, and not logged in."
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});
