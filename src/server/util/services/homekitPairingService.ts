import AppDataSource from "~/server/database/datasource";
import { encrypt, decryptIfEncrypted } from "~/server/util/tokenCrypto";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import type { PairingData } from "hap-controller";

export interface HomekitPairingData {
  id: string;
  airHandlerId: string;
  accessoryId: string;
  pairingData: PairingData;
  lastKnownAddress: string | null;
  lastKnownPort: number | null;
  pairedAt: Date;
  lastConnectError: string | null;
  lastConnectErrorAt: Date | null;
}

export async function getHomekitPairing(
  airHandlerId: string,
): Promise<HomekitPairingData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "HomekitPairing",
  );
  const record = await repo.findOne({
    where: { air_handler_id: airHandlerId },
  });
  if (!record) return null;
  return {
    id: record.id,
    airHandlerId: record.air_handler_id,
    accessoryId: record.accessory_id,
    pairingData: JSON.parse(decryptIfEncrypted(record.pairing_data)),
    lastKnownAddress: record.last_known_address,
    lastKnownPort: record.last_known_port,
    pairedAt: record.paired_at,
    lastConnectError: record.last_connect_error,
    lastConnectErrorAt: record.last_connect_error_at,
  };
}

// Called once, right after a live pairSetup() call has already succeeded —
// mirroring setFlairCredentials' "validate first, persist second" order.
export async function storeHomekitPairing(opts: {
  airHandlerId: string;
  accessoryId: string;
  pairingData: PairingData;
  address: string;
  port: number;
}): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "HomekitPairing",
  );
  const existing = await repo.findOne({
    where: { air_handler_id: opts.airHandlerId },
  });
  const fields = {
    accessory_id: opts.accessoryId,
    pairing_data: encrypt(JSON.stringify(opts.pairingData)),
    last_known_address: opts.address,
    last_known_port: opts.port,
    paired_at: new Date(),
    last_connect_error: null,
    last_connect_error_at: null,
  };
  if (existing) {
    await repo.update(existing.id, { ...fields, ...touch() });
  } else {
    await repo.insert(
      withTimestamps({ air_handler_id: opts.airHandlerId, ...fields }),
    );
  }
}

// Opportunistic — called after a successful reconnect finds the accessory
// at a different address/port than last recorded, purely to speed up the
// *next* connect attempt's cache-first fast path. Never authoritative on
// its own (see HapControllerClient.connect()).
export async function recordHomekitConnectionInfo(
  airHandlerId: string,
  address: string,
  port: number,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "HomekitPairing",
  );
  await repo.update(
    { air_handler_id: airHandlerId },
    { last_known_address: address, last_known_port: port },
  );
}

export async function recordHomekitConnectError(
  airHandlerId: string,
  message: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "HomekitPairing",
  );
  await repo.update(
    { air_handler_id: airHandlerId },
    { last_connect_error: message, last_connect_error_at: new Date() },
  );
}

export async function deleteHomekitPairing(
  airHandlerId: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "HomekitPairing",
  );
  await repo.delete({ air_handler_id: airHandlerId });
}
