import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = {
      loginEmail: "a@example.com",
      source: "member",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
    };
    next();
  },
}));
vi.mock("~/server/middleware/requirePermission", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const { getSchedulesForInstallation, getScheduleById } = vi.hoisted(() => ({
  getSchedulesForInstallation: vi.fn(),
  getScheduleById: vi.fn(),
}));
vi.mock("~/server/util/routes/schedule", () => ({
  getSchedulesForInstallation,
  getScheduleById,
}));

const {
  createScheduleForInstallation,
  updateScheduleWithValidation,
  deleteScheduleWithValidation,
} = vi.hoisted(() => ({
  createScheduleForInstallation: vi.fn(),
  updateScheduleWithValidation: vi.fn(),
  deleteScheduleWithValidation: vi.fn(),
}));
vi.mock("~/server/util/services/scheduleService", () => ({
  createScheduleForInstallation,
  updateScheduleWithValidation,
  deleteScheduleWithValidation,
}));

const { router } = await import("~/server/routes/schedules");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/schedules", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getSchedulesForInstallation.mockReset();
  getScheduleById.mockReset();
  createScheduleForInstallation.mockReset();
  updateScheduleWithValidation.mockReset();
  deleteScheduleWithValidation.mockReset();
});

describe("GET /api/v1/schedules", () => {
  it("lists every schedule for the caller's own installation", async () => {
    getSchedulesForInstallation.mockResolvedValue([{ id: "s1" }]);
    const res = await request(buildApp()).get("/api/v1/schedules");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "s1" }]);
    expect(getSchedulesForInstallation).toHaveBeenCalledWith("inst-1");
  });
});

describe("GET /api/v1/schedules/:id", () => {
  it("404s when not found", async () => {
    getScheduleById.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/schedules/missing");
    expect(res.status).toBe(404);
  });

  it("404s (not 403) when the schedule belongs to a different installation", async () => {
    getScheduleById.mockResolvedValue({
      id: "s1",
      installationId: "inst-other",
    });
    const res = await request(buildApp()).get("/api/v1/schedules/s1");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/schedules", () => {
  it("requires a name", async () => {
    const res = await request(buildApp()).post("/api/v1/schedules").send({});
    expect(res.status).toBe(400);
  });

  it("rejects an event with start_time === end_time", async () => {
    const res = await request(buildApp())
      .post("/api/v1/schedules")
      .send({
        name: "Night",
        events: [
          {
            mode: "inactive",
            start_time: "20:00",
            end_time: "20:00",
            days_of_week: 0b1111111,
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("creates with a well-formed body, scoped to the caller's installation", async () => {
    createScheduleForInstallation.mockResolvedValue({ id: "s1" });
    const res = await request(buildApp())
      .post("/api/v1/schedules")
      .send({ name: "Night", events: [] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "s1" });
    expect(createScheduleForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: "inst-1" }),
    );
  });
});

describe("PATCH /api/v1/schedules/:id", () => {
  it("updates with a well-formed partial body, passing the caller's installationId", async () => {
    updateScheduleWithValidation.mockResolvedValue({
      id: "s1",
      name: "New name",
    });
    const res = await request(buildApp())
      .patch("/api/v1/schedules/s1")
      .send({ name: "New name" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "s1", name: "New name" });
    expect(updateScheduleWithValidation).toHaveBeenCalledWith(
      "inst-1",
      "s1",
      expect.objectContaining({ name: "New name" }),
    );
  });
});

describe("DELETE /api/v1/schedules/:id", () => {
  it("deletes and returns 204, scoped to the caller's installation", async () => {
    deleteScheduleWithValidation.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete("/api/v1/schedules/s1");
    expect(res.status).toBe(204);
    expect(deleteScheduleWithValidation).toHaveBeenCalledWith("inst-1", "s1");
  });
});
