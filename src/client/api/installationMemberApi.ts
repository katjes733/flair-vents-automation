import { httpClient } from "~/client/api/httpClient";
import type { MemberRole } from "~/client/api/sessionApi";

export interface InstallationMemberScope {
  air_handler_ids: string[] | "*";
}

export interface InstallationMember {
  id: string;
  installationId: string;
  userId: string;
  email: string;
  role: MemberRole;
  scope: InstallationMemberScope;
  createdAt: string;
  // True until this member accepts their invite (the "" password_hash
  // placeholder sentinel, server-side) — an owner/admin never sees this
  // for themselves, only for someone they've invited.
  pending: boolean;
}

export async function fetchMembers(): Promise<InstallationMember[]> {
  const { data } = await httpClient.get<{ members: InstallationMember[] }>(
    "/installation-members",
  );
  return data.members;
}

export async function inviteMember(opts: {
  email: string;
  role: MemberRole;
}): Promise<InstallationMember> {
  const { data } = await httpClient.post<{ member: InstallationMember }>(
    "/installation-members/invite",
    opts,
  );
  return data.member;
}

export async function updateMemberRole(
  id: string,
  role: MemberRole,
): Promise<void> {
  await httpClient.patch(`/installation-members/${id}`, { role });
}

export async function revokeMember(id: string): Promise<void> {
  await httpClient.delete(`/installation-members/${id}`);
}

// Rejected (400) by the server if this member has already accepted their
// invite — see the route's own comment for why.
export async function resendInvite(id: string): Promise<void> {
  await httpClient.post(`/installation-members/${id}/resend-invite`);
}
