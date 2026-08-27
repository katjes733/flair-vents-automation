export interface OutageTracker {
  recordFailure(now?: number): void;
  recordSuccess(now?: number): void;
  isFailing(): boolean;
}

// Logs "Flair outage detected"/"Flair outage cleared" exactly once each
// transition, not once per failed tick — a control tick every 60s hitting a
// real outage would otherwise flood Loki with the same fact repeated.
export function createOutageTracker(installationId: string): OutageTracker {
  let failing = false;
  let since: number | null = null;
  const log = logger.child({
    service: "flair",
    installation_id: installationId,
  });

  return {
    recordFailure(now: number = Date.now()) {
      if (!failing) {
        failing = true;
        since = now;
        log.error("Flair outage detected");
      }
    },
    recordSuccess(now: number = Date.now()) {
      if (failing && since !== null) {
        log.info(
          { outage_duration_s: Math.round((now - since) / 1000) },
          "Flair outage cleared",
        );
      }
      failing = false;
      since = null;
    },
    isFailing() {
      return failing;
    },
  };
}
