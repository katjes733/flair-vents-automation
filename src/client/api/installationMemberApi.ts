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
