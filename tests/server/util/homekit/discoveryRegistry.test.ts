import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HapDiscoveryRegistry,
  type DiscoveryLike,
} from "~/server/util/homekit/discoveryRegistry";
import type { HapServiceIp } from "hap-controller";

function makeService(overrides: Partial<HapServiceIp> = {}): HapServiceIp {
  return {
    name: "Upstairs._hap._tcp.local.",
    address: "192.168.2.208",
    allAddresses: ["192.168.2.208"],
    port: 51_842,
    "c#": 1,
    ff: 0,
    id: "AA:BB:CC:DD:EE:FF",
    md: "Ecobee",
    pv: "1.1",
    "s#": 1,
    sf: 0,
    ci: 9,
    availableToPair: false,
    ...overrides,
  };
}

// A fake discovery browser — never touches a real socket/mDNS. Lets tests
// fire serviceUp/serviceChanged/serviceDown deterministically and assert
// on start()/stop() call counts, mirroring how FakeHomeKitClient/etc.
// stand in for the real HAP wire protocol elsewhere in this suite.
class FakeDiscovery implements DiscoveryLike {
  startCount = 0;
  stopCount = 0;
  private listeners = new Map<string, ((service: HapServiceIp) => void)[]>();

  on(
    event: "serviceUp" | "serviceChanged" | "serviceDown",
    listener: (service: HapServiceIp) => void,
  ): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  start(): void {
    this.startCount++;
  }

  stop(): void {
    this.stopCount++;
  }

  emit(
    event: "serviceUp" | "serviceChanged" | "serviceDown",
    service: HapServiceIp,
  ): void {
    for (const listener of this.listeners.get(event) ?? []) listener(service);
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe("HapDiscoveryRegistry", () => {
  let created: FakeDiscovery[];
  let interfaces: string[];

  function makeRegistry() {
    created = [];
    interfaces = ["10.0.0.5"];
    const log = makeLogger();
    const registry = new HapDiscoveryRegistry(
      log,
      () => {
        const fake = new FakeDiscovery();
        created.push(fake);
        return fake;
      },
      () => interfaces,
      30_000,
    );
    return { registry, log };
  }

  beforeEach(() => {
    created = [];
  });

  it("lookup returns null before anything has announced itself", () => {
    const { registry } = makeRegistry();
    registry.start();
    expect(registry.lookup("AA:BB:CC:DD:EE:FF")).toBeNull();
  });

  it("binds one browser per local interface plus one default-route browser on start", () => {
    const { registry } = makeRegistry();
    registry.start();
    expect(created).toHaveLength(2); // undefined (default) + "10.0.0.5"
    expect(created.every((d) => d.startCount === 1)).toBe(true);
  });

  it("populates the map on serviceUp and lookup finds it", () => {
    const { registry } = makeRegistry();
    registry.start();
    created[0].emit("serviceUp", makeService());
    expect(registry.lookup("AA:BB:CC:DD:EE:FF")).toEqual({
      address: "192.168.2.208",
      port: 51_842,
    });
  });

  it("serviceChanged updates an existing entry's address/port", () => {
    const { registry } = makeRegistry();
    registry.start();
    created[0].emit("serviceUp", makeService());
    created[0].emit(
      "serviceChanged",
      makeService({ address: "192.168.2.209", port: 51_999 }),
    );
    expect(registry.lookup("AA:BB:CC:DD:EE:FF")).toEqual({
      address: "192.168.2.209",
      port: 51_999,
    });
  });

  it("serviceDown removes the entry", () => {
    const { registry } = makeRegistry();
    registry.start();
    created[0].emit("serviceUp", makeService());
    created[0].emit("serviceDown", makeService());
    expect(registry.lookup("AA:BB:CC:DD:EE:FF")).toBeNull();
  });

  it("snapshot reports every visible accessory regardless of which one was looked up", () => {
    const { registry } = makeRegistry();
    registry.start();
    created[0].emit("serviceUp", makeService({ id: "id-1" }));
    created[0].emit("serviceUp", makeService({ id: "id-2" }));
    expect(registry.snapshot()).toEqual({
      totalVisible: 2,
      ids: ["id-1", "id-2"],
    });
  });

  it("start() is idempotent — a second call does not rebind", () => {
    const { registry } = makeRegistry();
    registry.start();
    registry.start();
    expect(created).toHaveLength(2); // still just the one initial rebind
  });

  describe("consecutive-miss self-healing rebind", () => {
    it("forces a full rebind after enough consecutive misses for one accessory", () => {
      const { registry, log } = makeRegistry();
      registry.start();
      const firstGeneration = [...created];

      for (let i = 0; i < 5; i++) {
        registry.lookup("AA:BB:CC:DD:EE:FF");
      }

      // Every browser from the first generation was torn down...
      expect(firstGeneration.every((d) => d.stopCount === 1)).toBe(true);
      // ...and a fresh generation was created in its place.
      expect(created).toHaveLength(4); // 2 initial + 2 rebound
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          accessory_id: "AA:BB:CC:DD:EE:FF",
          miss_streak: 5,
        }),
        expect.any(String),
      );
    });

    it("a successful lookup resets that accessory's own miss streak, so intermittent misses never accumulate into a rebind", () => {
      const { registry } = makeRegistry();
      registry.start();

      for (let i = 0; i < 4; i++) {
        registry.lookup("AA:BB:CC:DD:EE:FF"); // 4 misses — one short of the threshold
      }
      created[0].emit("serviceUp", makeService());
      registry.lookup("AA:BB:CC:DD:EE:FF"); // a hit — resets the streak back to 0
      for (let i = 0; i < 4; i++) {
        registry.lookup("some-other-id"); // a different accessory's own streak, unrelated
      }

      // Neither id ever hit 5 *consecutive* misses against itself, so
      // still only the initial 2 browsers exist.
      expect(created).toHaveLength(2);
    });
  });

  describe("maybeRebindForNetworkChange", () => {
    it("does nothing when the local interface list is unchanged", () => {
      const { registry } = makeRegistry();
      registry.start();
      const firstGeneration = [...created];

      registry.maybeRebindForNetworkChange();

      expect(created).toHaveLength(2); // no new browsers created
      expect(firstGeneration.every((d) => d.stopCount === 0)).toBe(true);
    });

    it("rebinds every browser when the local interface list changes", () => {
      const { registry, log } = makeRegistry();
      registry.start();
      const firstGeneration = [...created];

      interfaces = ["10.0.0.9"]; // simulates a DHCP-renewed address
      registry.maybeRebindForNetworkChange();

      expect(firstGeneration.every((d) => d.stopCount === 1)).toBe(true);
      expect(created).toHaveLength(4);
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ previous: "10.0.0.5", current: "10.0.0.9" }),
        expect.any(String),
      );
    });

    it("clears previously-known accessories on a rebind, since they must re-announce fresh", () => {
      const { registry } = makeRegistry();
      registry.start();
      created[0].emit("serviceUp", makeService());
      expect(registry.lookup("AA:BB:CC:DD:EE:FF")).not.toBeNull();

      interfaces = ["10.0.0.9"];
      registry.maybeRebindForNetworkChange();

      expect(registry.snapshot()).toEqual({ totalVisible: 0, ids: [] });
    });
  });

  describe("stop", () => {
    it("tears down every active browser", () => {
      const { registry } = makeRegistry();
      registry.start();
      const generation = [...created];
      registry.stop();
      expect(generation.every((d) => d.stopCount === 1)).toBe(true);
    });

    it("a browser whose stop() throws never blocks the others from being torn down", () => {
      const { registry } = makeRegistry();
      registry.start();
      created[0].stop = () => {
        throw new Error("socket already closed");
      };
      expect(() => registry.stop()).not.toThrow();
      expect(created[1].stopCount).toBe(1);
    });
  });
});
