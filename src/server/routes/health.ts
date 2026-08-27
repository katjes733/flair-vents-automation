import express from "express";

// Liveness only — deliberately not DB/Redis-dependent. This backs Docker's
// `--health-cmd` (see CI/CD & Deployment), whose job is catching a
// crash-looping container, not reporting downstream dependency health; a
// health check that fails on a momentary DB blip would cause Docker to kill
// and restart a perfectly-recoverable process.
export const router = express.Router();

router.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});
