import AppDataSource from "~/server/database/datasource";
import { encrypt, decryptIfEncrypted } from "~/server/util/tokenCrypto";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";

export interface FlairTokenData {
  id: string;
  installationId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  modifiedTime: Date;
  lastRefreshError: string | null;
  lastRefreshErrorAt: Date | null;
}

export async function upsertFlairToken(opts: {
  installationId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
}): Promise<FlairTokenData> {
  const repo = (await AppDataSource.getInstance()).getRepository("FlairToken");
  const existing = await repo.findOne({
    where: { installation_id: opts.installationId },
  });

  const fields = {
    access_token: encrypt(opts.accessToken),
    refresh_token: opts.refreshToken ? encrypt(opts.refreshToken) : null,
    expires_at: opts.expiresAt,
    scope: opts.scope,
    last_refresh_error: null,
    last_refresh_error_at: null,
  };

  if (existing) {
    await repo.update(existing.id, { ...fields, ...touch() });
  } else {
    await repo.insert(
      withTimestamps({ installation_id: opts.installationId, ...fields }),
    );
  }

  return getFlairTokenByInstallation(
    opts.installationId,
  ) as Promise<FlairTokenData>;
}

export async function recordFlairRefreshError(
  installationId: string,
  message: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("FlairToken");
  await repo.update(
    { installation_id: installationId },
    { last_refresh_error: message, last_refresh_error_at: new Date() },
  );
}

export async function getFlairTokenByInstallation(
  installationId: string,
): Promise<FlairTokenData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("FlairToken");
  const record = await repo.findOne({
    where: { installation_id: installationId },
  });
  if (!record) return null;
  return {
    id: record.id,
    installationId: record.installation_id,
    accessToken: decryptIfEncrypted(record.access_token),
    refreshToken: record.refresh_token
      ? decryptIfEncrypted(record.refresh_token)
      : null,
    expiresAt: record.expires_at,
    scope: record.scope,
    modifiedTime: record.modified_time,
    lastRefreshError: record.last_refresh_error,
    lastRefreshErrorAt: record.last_refresh_error_at,
  };
}

export interface FlairCredentials {
  clientId: string;
  clientSecret: string;
}

// Reads and decrypts this installation's own BYO Flair Client ID/Secret —
// null if this installation hasn't set them (only the one migrated
// pre-existing production installation should ever legitimately be in
// that state; see FlairApiClient's own fallback-with-a-warning handling
// of that case in src/server/util/flair/client.ts).
export async function resolveFlairCredentials(
  installationId: string,
): Promise<FlairCredentials | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("FlairToken");
  const record = await repo.findOne({
    where: { installation_id: installationId },
  });
  if (!record?.client_id || !record?.client_secret) return null;
  return {
    clientId: record.client_id,
    clientSecret: decryptIfEncrypted(record.client_secret),
  };
}

// Sets (or replaces) an installation's own BYO Flair Client ID/Secret —
// called once, during onboarding, after a live token-mint call with the
// submitted credentials has already succeeded (see the SaaS Transformation
// plan's "Flair BYO-Credentials Onboarding" section for why validation
// comes first). Deliberately separate from upsertFlairToken(): that
// function is called on every token refresh and has no reason to touch
// these long-lived credential fields at all.
export async function setFlairCredentials(opts: {
  installationId: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("FlairToken");
  const existing = await repo.findOne({
    where: { installation_id: opts.installationId },
  });
  const fields = {
    client_id: opts.clientId,
    client_secret: encrypt(opts.clientSecret),
  };
  if (existing) {
    await repo.update(existing.id, { ...fields, ...touch() });
  } else {
    await repo.insert(
      withTimestamps({ installation_id: opts.installationId, ...fields }),
    );
  }
}
