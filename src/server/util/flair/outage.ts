import {
  getOutageState,
  setOutageState,
  type OutageState,
} from "~/server/util/flair/outageStore";

export interface OutageTracker {
  recordFailure(now?: number): Promise<void>;
  recordSuccess(now?: number): Promise<void>;
  getState(): Promise<OutageState>;
}

// Logs "Flair outage detected"/"Flair outage cleared" exactly once each
// transition, not once per failed tick — a control tick every 60s hitting a
// real outage would otherwise flood Loki with the same fact repeated. State
// itself lives in Redis (outageStore.ts), keyed per installation — not in a
// closure — so the "exactly once" guarantee holds across worker processes,
// not just within one; see outageStore.ts's own comment for why that
// distinction is real once ticks can run on more than one worker.
export function createOutageTracker(installationId: string): OutageTracker {
  const log = logger.child({
    service: "flair",
    installation_id: installationId,
  });

  return {
    async recordFailure(now: number = Date.now()) {
      const state = await getOutageState(installationId);
      if (!state.failing) {
        await setOutageState(installationId, { failing: true, sinceMs: now });
        log.error("Flair outage detected");
      }
    },
    async recordSuccess(now: number = Date.now()) {
      const state = await getOutageState(installationId);
      if (state.failing && state.sinceMs !== null) {
        log.info(
          { outage_duration_s: Math.round((now - state.sinceMs) / 1000) },
          "Flair outage cleared",
        );
      }
      await setOutageState(installationId, { failing: false, sinceMs: null });
    },
    async getState() {
      return getOutageState(installationId);
    },
  };
}
