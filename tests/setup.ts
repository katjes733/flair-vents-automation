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
  // child() returns the same (already-spied) logger rather than a
  // disconnected stub — every server module here calls
  // logger.child({service: ...}) as its own convention, so logSpy() needs
  // to observe calls made through a child logger, not just direct
  // logger.error()/logger.info() calls. A fresh, unrelated stub per call
  // (the shape both reference apps use) would make those invisible here.
  vi.spyOn(logger, "child").mockReturnValue(logger);
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
