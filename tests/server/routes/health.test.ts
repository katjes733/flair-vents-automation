import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { router as HealthRouter } from "~/server/routes/health";

function buildApp() {
  const app = express();
  app.use("/api/v1/health", HealthRouter);
  return app;
}

describe("GET /api/v1/health", () => {
  it("responds 200 with an ok status, independent of any downstream dependency", async () => {
    const res = await request(buildApp()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
