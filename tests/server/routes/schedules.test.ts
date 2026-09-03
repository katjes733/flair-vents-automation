import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

const { getOrCreateDefaultInstallation } = vi.hoisted(() => ({
  getOrCreateDefaultInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getOrCreateDefaultInstallation,
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
  getOrCreateDefaultInstallation
    .mockReset()
    .mockResolvedValue({ id: "inst-1" });
  getSchedulesForInstallation.mockReset();
  getScheduleById.mockReset();
  createScheduleForInstallation.mockReset();
  updateScheduleWithValidation.mockReset();
  deleteScheduleWithValidation.mockReset();
});

describe("GET /api/v1/schedules", () => {
  it("lists every schedule for the installation", async () => {
    getSchedulesForInstallation.mockResolvedValue([{ id: "s1" }]);
    const res = await request(buildApp()).get("/api/v1/schedules");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "s1" }]);
  });
});

describe("GET /api/v1/schedules/:id", () => {
  it("404s when not found", async () => {
    getScheduleById.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/schedules/missing");
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

  it("creates with a well-formed body", async () => {
    createScheduleForInstallation.mockResolvedValue({ id: "s1" });
    const res = await request(buildApp())
      .post("/api/v1/schedules")
      .send({ name: "Night", events: [] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "s1" });
  });
});

describe("PATCH /api/v1/schedules/:id", () => {
  it("updates with a well-formed partial body", async () => {
    updateScheduleWithValidation.mockResolvedValue({
      id: "s1",
      name: "New name",
    });
    const res = await request(buildApp())
      .patch("/api/v1/schedules/s1")
      .send({ name: "New name" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "s1", name: "New name" });
  });
});

describe("DELETE /api/v1/schedules/:id", () => {
  it("deletes and returns 204", async () => {
    deleteScheduleWithValidation.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete("/api/v1/schedules/s1");
    expect(res.status).toBe(204);
  });
});
