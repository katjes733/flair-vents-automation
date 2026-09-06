import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import type { IUser } from "~/server/database/models/user";

export interface UserData {
  id: string;
  email: string;
  passwordHash: string;
  userDetails: Record<string, unknown>;
}

function toUserData(record: IUser & { id: string }): UserData {
  return {
    id: record.id,
    email: record.email,
    passwordHash: record.password_hash,
    userDetails: record.user_details,
  };
}

export async function getUserByEmail(email: string): Promise<UserData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("User");
  const record = await repo.findOneBy({ email });
  return record ? toUserData(record as IUser & { id: string }) : null;
}

export async function getUserById(id: string): Promise<UserData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("User");
  const record = await repo.findOneBy({ id });
  return record ? toUserData(record as IUser & { id: string }) : null;
}

export async function createUser(opts: {
  email: string;
  passwordHash: string;
  userDetails?: Record<string, unknown>;
}): Promise<UserData> {
  const repo = (await AppDataSource.getInstance()).getRepository("User");
  const fields = withTimestamps({
    email: opts.email,
    password_hash: opts.passwordHash,
    user_details: opts.userDetails ?? {},
  });
  await repo.insert(fields);
  return {
    id: fields.id,
    email: fields.email,
    passwordHash: fields.password_hash,
    userDetails: fields.user_details,
  };
}

// The invite-acceptance flow's own write path — an invited member's row
// already exists (created with the "" placeholder sentinel at invite
// time), so accepting the invite is a password update, never a second
// insert.
export async function updateUserPassword(
  userId: string,
  passwordHash: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("User");
  await repo.update(userId, { password_hash: passwordHash, ...touch() });
}
