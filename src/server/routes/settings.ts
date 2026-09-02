import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { systemSettingsConfigPartialSchema } from "~/shared/schemas/systemSettings";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";

export const router = express.Router();

router.get("/", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const config = await getSystemSettings(installation.id);
  res.status(200).json(config);
});

router.patch(
  "/",
  validateBody(systemSettingsConfigPartialSchema),
  async (req, res) => {
    const installation = await getOrCreateDefaultInstallation();
    const result = await updateSettingsForInstallation(
      installation.id,
      req.body,
    );
    res.status(200).json(result);
  },
);
