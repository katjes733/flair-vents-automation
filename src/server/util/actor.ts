import type { ProfileName } from "~/shared/permissions/profile";
import type { InstallationMemberRole } from "~/server/database/models/installationMember";

export type ActorSource = "member" | "system";

export interface Actor {
  loginEmail: string; // the actual authenticated login identity; SYSTEM_TICK_LOGIN_EMAIL for the control loop
  source: ActorSource;
  installationId: string; // the installation this request is acting on behalf of
  role: InstallationMemberRole;
  profile: ProfileName; // effective profile for installationId
  scope: { airHandlerIds: string[] | "*" }; // accessible air handlers under installationId
}

export const SYSTEM_TICK_LOGIN_EMAIL = "system:tick";
