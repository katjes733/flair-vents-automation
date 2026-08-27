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
