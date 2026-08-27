const retryLog = logger.child({ service: "retry" });

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  initialDelayMs = 2000,
  backoffFactor = 2,
): Promise<T> {
  let lastError: unknown;
  let currentDelay = initialDelayMs;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      retryLog.warn(
        { attempt: i + 1, maxRetries: retries, err: error },
        "Retry attempt failed",
      );
      await new Promise((res) => setTimeout(res, currentDelay));
      currentDelay *= backoffFactor;
    }
  }
  throw lastError;
}
