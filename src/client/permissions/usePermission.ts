import { useMemo } from "react";
import { useSession } from "~/client/session/useSession";
import { getElementState } from "~/shared/permissions/profile";
import type { ActionKey, AccessLevel } from "~/shared/permissions/schema";

// Resolves an ActionKey to the caller's current AccessLevel entirely
// client-side, with no API call — getElementState is a pure function of
// the profile name already carried on the session's own user object (see
// buildSessionUser on the server), so a permission check here is exactly
// as cheap as reading a boolean. Server-side requirePermission is still
// the real enforcement (this can never be trusted on its own — see that
// middleware's own comment) — this hook exists purely so the UI can match
// what the server will actually allow, instead of always rendering every
// control as if the caller were an owner.
export function usePermission(action: ActionKey): AccessLevel {
  const { user } = useSession();
  return useMemo(() => {
    if (!user?.profile) return "none";
    return getElementState(user.profile, action);
  }, [user?.profile, action]);
}

// Convenience for the common case — most call sites just want "can I
// actually click this," not the three-way none/read/write distinction.
export function useCanWrite(action: ActionKey): boolean {
  return usePermission(action) === "write";
}
