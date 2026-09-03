import { describe, it, expect } from "vitest";
import {
  resolveManualOverride,
  computeOverrideExpiry,
  findNextEventBoundary,
  type StoredManualOverride,
} from "~/server/domain/targets/manualOverride";

const NOW = Date.UTC(2024, 0, 1, 12, 0);

const config: StoredManualOverride["config"] = {
  kind: "position",
  value: 50,
  hold_type: "permanent",
  actor: "Martin",
};

describe("resolveManualOverride", () => {
  it("returns null when there is no override", () => {
    expect(resolveManualOverride(null, NOW)).toBeNull();
  });

  it("returns the config when active", () => {
    const override: StoredManualOverride = {
      config,
      expiresAtMs: null,
      revokedAtMs: null,
    };
    expect(resolveManualOverride(override, NOW)).toEqual(config);
  });

  it("ignores an expired override", () => {
    const override: StoredManualOverride = {
      config,
      expiresAtMs: NOW - 1000,
      revokedAtMs: null,
    };
    expect(resolveManualOverride(override, NOW)).toBeNull();
  });

  it("ignores a revoked override even if not yet expired", () => {
    const override: StoredManualOverride = {
      config,
      expiresAtMs: NOW + 100000,
      revokedAtMs: NOW - 1000,
    };
    expect(resolveManualOverride(override, NOW)).toBeNull();
  });
});

describe("computeOverrideExpiry", () => {
  it("computes 2h/4h holds relative to now", () => {
    expect(computeOverrideExpiry("2h", NOW, null)).toBe(
      NOW + 2 * 60 * 60 * 1000,
    );
    expect(computeOverrideExpiry("4h", NOW, null)).toBe(
      NOW + 4 * 60 * 60 * 1000,
    );
  });

  it("permanent never expires", () => {
    expect(computeOverrideExpiry("permanent", NOW, null)).toBeNull();
  });

  it("until_next_event passes through the scanned boundary", () => {
    expect(computeOverrideExpiry("until_next_event", NOW, NOW + 60000)).toBe(
      NOW + 60000,
    );
  });
});

describe("findNextEventBoundary", () => {
  it("finds the next start/end transition, scanning forward across midnight", () => {
    // Event active 23:50-00:10 local (UTC here, no timezone offset needed
    // for this pure scan-logic test) — the next boundary after "now" is
    // its end time.
    const event = {
      start_time: "23:50",
      end_time: "00:10",
      days_of_week: 0b1111111,
    };
    const justBeforeMidnight = Date.UTC(2024, 0, 1, 23, 55);
    const boundary = findNextEventBoundary([event], justBeforeMidnight, "UTC");
    expect(boundary).not.toBeNull();
    expect(boundary).toBe(Date.UTC(2024, 0, 2, 0, 10));
  });

  it("returns null when nothing changes within the horizon", () => {
    const event = {
      start_time: "00:00",
      end_time: "23:59",
      days_of_week: 0b1111111,
    };
    const boundary = findNextEventBoundary(
      [event],
      NOW,
      "UTC",
      60 * 60 * 1000,
      60000,
    );
    expect(boundary).toBeNull();
  });
});
