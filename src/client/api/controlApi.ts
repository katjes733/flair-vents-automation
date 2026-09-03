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

// Runs one immediate control-loop cycle server-side — called right after a
// Sync Engine import/link so the new zone's reading/classification shows
// up without waiting for the next scheduled tick (up to a full tick
// interval away). Coalesced server-side with the scheduled loop, so this
// never runs a second cycle concurrently with an in-flight one.
export async function triggerTick(): Promise<void> {
  await httpClient.post("/control/trigger-tick");
}

// See "Stage 12 — Current-Status Diagnostics" — FlairConnection's live
// half. Every field is a direct read of state the server already tracks;
// nothing is computed client-side.
export interface FlairStatus {
  outage: { failing: boolean; sinceMs: number | null };
  tokenRefreshFailure: { terminal: boolean; message: string } | null;
  tokenCallsToday: number;
  tokenDailyBudget: number;
}

export async function fetchFlairStatus(): Promise<FlairStatus> {
  const { data } = await httpClient.get<FlairStatus>("/control/flair-status");
  return data;
}
