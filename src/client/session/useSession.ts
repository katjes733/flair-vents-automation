import { useContext } from "react";
import { SessionContext } from "~/client/session/sessionContextValue";

export const useSession = () => useContext(SessionContext);
