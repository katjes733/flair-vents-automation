import os from "os";
import { IPDiscovery, type HapServiceIp } from "hap-controller";

// A real, confirmed incident (2026-09-12/13): the HomeKit connection to an
// Ecobee's HAP bridge failed continuously for 30+ hours after a router
// reboot (which also renews DHCP leases). Root-caused to two real gaps in
// the previous "one fresh IPDiscovery + a 5s timeout, per tick" design:
//
//  1. hap-controller's IPDiscovery wraps `dnssd`, whose own active query
//     only sends ~3 packets in a 5s window (an exponential backoff
//     starting at 1s) — a thin, easily-missed burst on a LAN segment
//     still settling right after a reboot (switches/APs relearning IGMP
//     group membership takes time), rather than a sustained listen.
//  2. `dnssd` keeps one process-lifetime singleton socket per network
//     interface behind the scenes. A fresh `IPDiscovery` object every tick
//     is cosmetic if that singleton's own start/stop bookkeeping ever gets
//     unbalanced (a hung tick, an overlapping call) — the underlying
//     socket then stays bound in whatever state existed at the moment of
//     the network event, forever, with nothing to notice and force a
//     rebuild. Only a full process restart reliably clears that.
//
// Mature HomeKit controllers solve this the same way: homebridge/ciao
// exists specifically because its predecessor "only advertises on the
// primary network interface" and doesn't react to interface/address
// changes; Home Assistant's own `homekit_controller` integration has hit
// the identical class of bug (home-assistant/core#88403 — needs a full
// restart to reconnect after losing a device). The fix that generalizes:
// keep ONE persistent, interface-aware discovery process running for the
// life of this process, watch for the environment changing underneath it,
// and force a rebuild rather than trusting an accidental clean tick.
//
// This registry is that persistent process. `HapControllerClient.connect()`
// reads from it (an in-memory lookup, no network round trip) instead of
// running its own one-shot discovery every tick.

export interface HapDiscoveredAddress {
  address: string;
  port: number;
}

export interface DiscoveryRegistryLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

// The minimal surface this registry needs from an IPDiscovery instance —
// narrowed down from hap-controller's real (EventEmitter-based) class so
// tests can inject a fake without touching a real socket/mDNS at all.
export interface DiscoveryLike {
  on(
    event: "serviceUp" | "serviceChanged" | "serviceDown",
    listener: (service: HapServiceIp) => void,
  ): void;
  start(): void;
  stop(): void;
}

const NETWORK_CHECK_INTERVAL_MS = 30_000;
// ~5 minutes at the normal once-a-minute tick cadence — long enough that a
// single slow/unlucky tick isn't a false trigger, short enough that a
// stuck registry doesn't silently ride out another 30-hour incident before
// self-correcting.
const MISS_STREAK_REBIND_THRESHOLD = 5;

/** Every non-internal IPv4 address currently assigned to this host, sorted for stable comparison. */
export function localIPv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === "IPv4" && !addr.internal)
        addresses.push(addr.address);
    }
  }
  return addresses.sort();
}

export class HapDiscoveryRegistry {
  private browsers: DiscoveryLike[] = [];
  private known = new Map<string, HapDiscoveredAddress>();
  private missStreakByAccessoryId = new Map<string, number>();
  private lastFingerprint = "";
  private networkCheckTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly log: DiscoveryRegistryLogger,
    private readonly createDiscovery: (iface?: string) => DiscoveryLike = (
      iface,
    ) => new IPDiscovery(iface),
    private readonly listLocalInterfaces: () => string[] = localIPv4Addresses,
    private readonly networkCheckIntervalMs = NETWORK_CHECK_INTERVAL_MS,
  ) {}

  /** Idempotent — safe to call from every HapControllerClient construction. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.rebind("initial start");
    this.networkCheckTimer = setInterval(
      () => this.maybeRebindForNetworkChange(),
      this.networkCheckIntervalMs,
    );
    this.networkCheckTimer.unref?.();
  }

  stop(): void {
    if (this.networkCheckTimer) clearInterval(this.networkCheckTimer);
    this.networkCheckTimer = null;
    this.started = false;
    this.teardown();
  }

  /**
   * The fast path — an in-memory read, no network round trip. Bumps a
   * per-accessory miss streak on a miss, forcing a full rebind once it
   * crosses the threshold — the self-healing trigger the previous
   * per-tick-only design had no equivalent of.
   */
  lookup(accessoryId: string): HapDiscoveredAddress | null {
    const entry = this.known.get(accessoryId);
    if (!entry) {
      this.recordMiss(accessoryId);
      return null;
    }
    this.missStreakByAccessoryId.delete(accessoryId);
    return entry;
  }

  /** Diagnostic: how many HAP accessories are visible on the LAN at all right now, regardless of ID — distinguishes "mDNS itself is broken" from "just this one device is unreachable." */
  snapshot(): { totalVisible: number; ids: string[] } {
    return { totalVisible: this.known.size, ids: [...this.known.keys()] };
  }

  /** Exposed (not just the interval above) so tests can trigger this deterministically without real timers. */
  maybeRebindForNetworkChange(): void {
    const fingerprint = this.listLocalInterfaces().join(",");
    if (fingerprint === this.lastFingerprint) return;
    this.log.info(
      { previous: this.lastFingerprint, current: fingerprint },
      "Local network interfaces changed — rebinding HAP mDNS discovery",
    );
    this.rebind("interface change");
  }

  private recordMiss(accessoryId: string): void {
    const next = (this.missStreakByAccessoryId.get(accessoryId) ?? 0) + 1;
    this.missStreakByAccessoryId.set(accessoryId, next);
    if (next === MISS_STREAK_REBIND_THRESHOLD) {
      this.log.warn(
        { accessory_id: accessoryId, miss_streak: next },
        "HAP accessory not seen for several consecutive lookups — forcing a full mDNS rebind",
      );
      this.rebind("consecutive miss streak");
    }
  }

  private teardown(): void {
    for (const browser of this.browsers) {
      try {
        browser.stop();
      } catch {
        // Best-effort teardown — a throw here must never block rebuilding
        // fresh browsers right after in rebind().
      }
    }
    this.browsers = [];
  }

  // One browser per currently-active local IPv4 interface, plus one on
  // hap-controller's own OS-default-route behavior (passing no interface
  // at all) kept as a racer in case that default happens to be correct —
  // rather than trusting a single default-route socket to always pick the
  // right interface, which dnssd's own send path does not guarantee (see
  // this module's own top-of-file comment).
  private rebind(reason: string): void {
    this.teardown();
    this.known.clear();
    this.missStreakByAccessoryId.clear();
    this.lastFingerprint = this.listLocalInterfaces().join(",");

    const targets: Array<string | undefined> = [
      undefined,
      ...this.listLocalInterfaces(),
    ];
    const joined: string[] = [];
    const failed: Array<{ iface: string; error: string }> = [];

    for (const iface of targets) {
      const label = iface ?? "(default route)";
      try {
        const discovery = this.createDiscovery(iface);
        discovery.on("serviceUp", (s) => this.upsert(s));
        discovery.on("serviceChanged", (s) => this.upsert(s));
        discovery.on("serviceDown", (s) => this.known.delete(s.id));
        discovery.start();
        this.browsers.push(discovery);
        joined.push(label);
      } catch (err) {
        failed.push({
          iface: label,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log.info(
      { reason, joined_interfaces: joined, failed_interfaces: failed },
      "HAP mDNS discovery (re)bound",
    );
  }

  private upsert(service: HapServiceIp): void {
    this.known.set(service.id, {
      address: service.address,
      port: service.port,
    });
  }
}

export const hapDiscoveryRegistry = new HapDiscoveryRegistry(
  logger.child({ service: "homekit-discovery" }),
);
