import { httpClient } from "~/client/api/httpClient";

// Free-text display name, not a real user id — no login yet, so this is
// the only way to attribute a disarm/rearm action per "The 'who' in
// 'logged clearly'" in the implementation plan. Same per-browser
// localStorage key convention used for manual override "actor" too, so
// the two flows can share one prompt/story.
const ACTOR_STORAGE_KEY = "actorDisplayName";

export function getStoredActor(): string {
  try {
    return localStorage.getItem(ACTOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredActor(actor: string): void {
  try {
    localStorage.setItem(ACTOR_STORAGE_KEY, actor);
  } catch {
    // ignore — the prompt just reappears next time
  }
}

export async function disarmControl(actor: string): Promise<void> {
  await httpClient.post("/control/disarm", { actor });
}

export async function rearmControl(actor: string): Promise<void> {
  await httpClient.post("/control/rearm", { actor });
}
