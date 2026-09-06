import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import type { IWebauthnCredential } from "~/server/database/models/webauthnCredential";
import type { IBasicEntity } from "~/server/types/common";

type WebauthnCredentialRecord = IBasicEntity & IWebauthnCredential;

async function repo() {
  return (
    await AppDataSource.getInstance()
  ).getRepository<WebauthnCredentialRecord>("WebauthnCredential");
}

export async function create(params: {
  userId: string;
  credentialId: string;
  publicKey: string;
  transports?: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  nickname?: string;
}): Promise<WebauthnCredentialRecord> {
  const now = new Date();
  const record: WebauthnCredentialRecord = {
    id: v4(),
    creation_time: now,
    modified_time: now,
    user_id: params.userId,
    credential_id: params.credentialId,
    public_key: params.publicKey,
    sign_counter: 0,
    transports: params.transports ?? null,
    device_type: params.deviceType,
    backed_up: params.backedUp,
    nickname: params.nickname ?? null,
    last_used_at: null,
  };
  await (await repo()).insert(record);
  return record;
}

export async function findByCredentialId(
  credentialId: string,
): Promise<WebauthnCredentialRecord | null> {
  return (await repo()).findOneBy({ credential_id: credentialId });
}

export async function findByUserId(
  userId: string,
): Promise<WebauthnCredentialRecord[]> {
  return (await repo()).find({
    where: { user_id: userId },
    order: { creation_time: "ASC" },
  });
}

export async function recordUse(
  id: string,
  signCounter: number,
): Promise<void> {
  await (
    await repo()
  ).update(id, {
    sign_counter: signCounter,
    last_used_at: new Date(),
    modified_time: new Date(),
  });
}

// Returns the deleted row (or null if it didn't exist / belonged to a
// different user — callers must not distinguish the two in the response,
// to avoid leaking which is the case) so the caller can reference its
// nickname without a second query.
export async function deleteForUser(
  id: string,
  userId: string,
): Promise<WebauthnCredentialRecord | null> {
  const r = await repo();
  const record = await r.findOneBy({ id, user_id: userId });
  if (!record) return null;
  await r.delete({ id, user_id: userId });
  return record;
}
