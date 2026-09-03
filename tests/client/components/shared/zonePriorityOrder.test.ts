import { describe, it, expect } from "vitest";
import { normalizeZonePriorityOrder } from "~/client/components/shared/zonePriorityOrder";

describe("normalizeZonePriorityOrder", () => {
  it("keeps known ids in their given relative order", () => {
    expect(normalizeZonePriorityOrder(["b", "a"], ["a", "b"])).toEqual([
      "b",
      "a",
    ]);
  });

  it("appends a zone missing from value, in zoneIds order", () => {
    expect(normalizeZonePriorityOrder(["a"], ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("drops a stale id no longer among zoneIds", () => {
    expect(normalizeZonePriorityOrder(["a", "deleted"], ["a"])).toEqual(["a"]);
  });

  it("dedupes a repeated id in value, keeping its first occurrence", () => {
    expect(normalizeZonePriorityOrder(["a", "a"], ["a"])).toEqual(["a"]);
  });

  it("returns every zone in zoneIds order when value is empty", () => {
    expect(normalizeZonePriorityOrder([], ["a", "b"])).toEqual(["a", "b"]);
  });
});
