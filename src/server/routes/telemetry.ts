import express from "express";
import { z } from "zod";
import { HttpError } from "~/server/util/httpError";
import { getAirHandlerById } from "~/server/util/routes/airHandler";
import { isLokiConfigured, fetchTickDecisionHistory } from "~/server/util/loki";

export const router = express.Router();

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
// Matches the widest trailing window TelemetryPage's own range picker
// offers — a wider request would mean either a badly-formed client request
// or an attempt to pull far more of Loki's retention than any chart here
// actually renders at once.
const MAX_RANGE_MS = 7 * 24 * 3600 * 1000;

const queryParamsSchema = z.object({
  fromMs: z.coerce.number().int().nonnegative(),
  toMs: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

// Historical tick-decision points for one air handler — see
// "Stage 13, Increment B" in the implementation plan. Backs every
// historical chart (zone temperature, vent position, HVAC state, open
// capacity, spike/degraded/fault periods) and the rolling shadow-mode
// agreement metric off ONE query type, since the `Control tick decision`
// event already carries the full exhaustive per-tick record.
router.get("/:airHandlerId/tick-history", async (req, res) => {
  const parsed = queryParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(
      "fromMs and toMs (epoch milliseconds) are required query params.",
      400,
    );
  }
  const { fromMs, toMs, limit } = parsed.data;
  if (toMs <= fromMs) {
    throw new HttpError("toMs must be after fromMs.", 400);
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    throw new HttpError(
      `Requested range is too wide — max ${MAX_RANGE_MS / 3_600_000} hours.`,
      400,
    );
  }

  const airHandler = await getAirHandlerById(req.params.airHandlerId);
  if (!airHandler) {
    throw new HttpError(
      `Air handler ${req.params.airHandlerId} not found.`,
      404,
    );
  }

  if (!isLokiConfigured()) {
    throw new HttpError(
      "Historical telemetry is not available — LOKI_URL is not configured.",
      503,
    );
  }

  const points = await fetchTickDecisionHistory(
    req.params.airHandlerId,
    fromMs,
    toMs,
    limit ?? DEFAULT_LIMIT,
  );
  res.status(200).json({ points });
});
