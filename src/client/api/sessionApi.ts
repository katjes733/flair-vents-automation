import { httpClient } from "~/client/api/httpClient";

export type MemberRole = "owner" | "admin" | "write" | "read";
export type ProfileName = "read" | "write" | "admin";

// Mirrors the server's own buildSessionUser() response shape exactly
// (src/server/util/sessionEstablish.ts) — installationLinked: false is a
// legitimate mid-signup state (email/password verified, BYO Flair
// credentials not yet submitted), not a login failure; the client routes
// that case to the signup flow's "connect your Flair account" step rather
// than the dashboard.
export interface SessionUser {
  loginEmail: string;
  installationId: string | null;
  installationName: string | null;
  role: MemberRole | null;
  profile: ProfileName | null;
  installationLinked: boolean;
}

export interface SessionResult {
  message: string;
  user: SessionUser | null;
  sessionExpiry: number;
}

export async function fetchMe(): Promise<SessionUser | null> {
  const { data } = await httpClient.get<{
    user: SessionUser | null;
    sessionExpiry: number;
  }>("/session/me");
  return data.user;
}

export async function login(
  email: string,
  password: string,
): Promise<SessionResult> {
  const { data } = await httpClient.post<SessionResult>("/session/login", {
    email,
    password,
  });
  return data;
}

export async function logout(): Promise<void> {
  await httpClient.post("/session/logout");
}

// Destroys every session this login currently has, including the one
// making this call — there is no "log out every OTHER device" variant, see
// the server route's own comment for why.
export async function logoutEverywhere(): Promise<void> {
  await httpClient.post("/session/logout-everywhere");
}
