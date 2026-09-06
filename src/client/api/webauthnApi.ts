import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { httpClient } from "~/client/api/httpClient";
import type { SessionResult } from "~/client/api/sessionApi";

export { browserSupportsWebAuthn };

// No username hint is sent — this app's login ceremony is fully
// discoverable (residentKey: "required" at registration time), matching
// the server's own /webauthn/login/options, which accepts no body at all.
export async function loginWithPasskey(): Promise<SessionResult> {
  const { data: optionsJSON } =
    await httpClient.post<PublicKeyCredentialRequestOptionsJSON>(
      "/webauthn/login/options",
    );
  const response = await startAuthentication({ optionsJSON });
  const { data } = await httpClient.post<SessionResult>(
    "/webauthn/login/verify",
    response,
  );
  return data;
}

export async function registerPasskey(nickname?: string): Promise<void> {
  const { data: optionsJSON } =
    await httpClient.post<PublicKeyCredentialCreationOptionsJSON>(
      "/webauthn/register/options",
      { nickname },
    );
  const response = await startRegistration({ optionsJSON });
  await httpClient.post("/webauthn/register/verify", { ...response, nickname });
}

export interface PasskeyCredential {
  id: string;
  credentialId: string;
  nickname: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function fetchPasskeys(): Promise<PasskeyCredential[]> {
  const { data } = await httpClient.get<{ credentials: PasskeyCredential[] }>(
    "/webauthn/credentials",
  );
  return data.credentials;
}

export async function deletePasskey(id: string): Promise<void> {
  await httpClient.delete(`/webauthn/credentials/${id}`);
}
