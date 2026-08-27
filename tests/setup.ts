import { vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";

// Pinned so schedule/DST tests behave identically between a developer's
// local timezone and CI's own default — neither reference app sets this,
// and it's a real flake risk for a DST-sensitive app. Individual DST test
// cases still evaluate against an explicitly DST-observing IANA zone
// (e.g. America/Denver) regardless of this process-level default.
process.env.TZ = "UTC";

// ---------------------------------------------------------------------------
// Logger silencing — applies to every test automatically.
//
// To assert on log calls in a specific test, use logSpy():
//
//   import { logSpy } from "../setup";
//   expect(logSpy("error")).toHaveBeenCalledWith(
//     expect.objectContaining({ err: expect.anything() }),
//     "Control tick failed",
//   );
// ---------------------------------------------------------------------------

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const noop = (): void => {};

function makeChildStub(): unknown {
  const stub: Record<string, unknown> = {};
  for (const lvl of [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ] as LogLevel[]) {
    stub[lvl] = vi.fn(noop);
  }
  stub["child"] = vi.fn(makeChildStub);
  return stub;
}

beforeEach(() => {
  for (const lvl of [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ] as LogLevel[]) {
    vi.spyOn(logger, lvl).mockImplementation(noop);
  }
  vi.spyOn(logger, "child").mockImplementation(
    makeChildStub as typeof logger.child,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Returns the spy for a top-level logger method so you can assert on it.
 * Only valid inside a test body — the spy is set up in beforeEach.
 */
export function logSpy(level: LogLevel): MockInstance {
  return logger[level] as unknown as MockInstance;
}
