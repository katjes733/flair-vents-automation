import { describe, it, expect, vi, beforeEach } from "vitest";

const { QueueMock, queueInstance } = vi.hoisted(() => {
  const queueInstance = {
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    getJobSchedulers: vi.fn(),
  };
  // A real `function`, not an arrow — `new QueueMock(...)` needs a
  // constructor, and a function that explicitly returns an object
  // overrides `this` per JS semantics, which is exactly what lets this
  // stand in for the real `new Queue(...)` in queue.ts.
  const QueueMock = vi.fn(function () {
    return queueInstance;
  });
  return { QueueMock, queueInstance };
});
vi.mock("bullmq", () => ({ Queue: QueueMock }));

vi.mock("~/server/control/queueConnection", () => ({
  queueConnection: {},
}));

const { getActiveInstallations } = vi.hoisted(() => ({
  getActiveInstallations: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getActiveInstallations,
}));

const { getSystemSettings } = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("~/server/util/routes/systemSettings", () => ({ getSystemSettings }));

const {
  registerInstallationTick,
  deregisterInstallationTick,
  reconcileInstallationSchedulers,
} = await import("~/server/control/queue");

beforeEach(() => {
  queueInstance.upsertJobScheduler.mockReset().mockResolvedValue(undefined);
  queueInstance.removeJobScheduler.mockReset().mockResolvedValue(undefined);
  queueInstance.getJobSchedulers.mockReset().mockResolvedValue([]);
  getActiveInstallations.mockReset().mockResolvedValue([]);
  getSystemSettings
    .mockReset()
    .mockResolvedValue({ control_tick_interval_seconds: 60 });
});

describe("registerInstallationTick", () => {
  it("upserts a repeatable run-tick job scheduler keyed by installation id, using that installation's own cadence", async () => {
    getSystemSettings.mockResolvedValue({ control_tick_interval_seconds: 30 });
    await registerInstallationTick("inst-1");
    expect(queueInstance.upsertJobScheduler).toHaveBeenCalledWith(
      "inst-1",
      { every: 30_000 },
      { name: "run-tick", data: { installationId: "inst-1" } },
    );
  });
});

describe("deregisterInstallationTick", () => {
  it("removes the job scheduler by installation id", async () => {
    await deregisterInstallationTick("inst-1");
    expect(queueInstance.removeJobScheduler).toHaveBeenCalledWith("inst-1");
  });
});

describe("reconcileInstallationSchedulers", () => {
  it("always ensures the queue-health-snapshot job scheduler exists", async () => {
    await reconcileInstallationSchedulers();
    expect(queueInstance.upsertJobScheduler).toHaveBeenCalledWith(
      "queue-health-snapshot",
      { every: 30_000 },
      { name: "queue-health-snapshot", data: {} },
    );
  });

  it("registers a scheduler for an active installation that has none yet", async () => {
    getActiveInstallations.mockResolvedValue([
      { id: "inst-1", name: "Home", flairStructureId: "s1", isActive: true },
    ]);
    queueInstance.getJobSchedulers.mockResolvedValue([]);
    await reconcileInstallationSchedulers();
    expect(queueInstance.upsertJobScheduler).toHaveBeenCalledWith(
      "inst-1",
      { every: 60_000 },
      { name: "run-tick", data: { installationId: "inst-1" } },
    );
  });

  it("does not re-register an installation that already has a scheduler", async () => {
    getActiveInstallations.mockResolvedValue([
      { id: "inst-1", name: "Home", flairStructureId: "s1", isActive: true },
    ]);
    queueInstance.getJobSchedulers.mockResolvedValue([
      { key: "k", name: "run-tick", id: "inst-1" },
    ]);
    await reconcileInstallationSchedulers();
    const installationUpserts =
      queueInstance.upsertJobScheduler.mock.calls.filter(
        (c) => c[0] === "inst-1",
      );
    expect(installationUpserts).toHaveLength(0);
  });

  it("removes a scheduler for an installation no longer active", async () => {
    getActiveInstallations.mockResolvedValue([]);
    queueInstance.getJobSchedulers.mockResolvedValue([
      { key: "k", name: "run-tick", id: "inst-stale" },
    ]);
    await reconcileInstallationSchedulers();
    expect(queueInstance.removeJobScheduler).toHaveBeenCalledWith("inst-stale");
  });

  it("never treats the queue-health-snapshot scheduler itself as a stale installation", async () => {
    getActiveInstallations.mockResolvedValue([]);
    queueInstance.getJobSchedulers.mockResolvedValue([
      {
        key: "k",
        name: "queue-health-snapshot",
        id: "queue-health-snapshot",
      },
    ]);
    await reconcileInstallationSchedulers();
    expect(queueInstance.removeJobScheduler).not.toHaveBeenCalledWith(
      "queue-health-snapshot",
    );
  });
});
