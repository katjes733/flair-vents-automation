import { httpClient } from "~/client/api/httpClient";

// Requires re-entering the current password as a confirmation step — see
// the server route's own comment. Rejects (400, not 401 — see there for
// why) if the caller is the sole owner of an installation.
export async function deleteAccount(password: string): Promise<void> {
  await httpClient.delete("/account", { data: { password } });
}
