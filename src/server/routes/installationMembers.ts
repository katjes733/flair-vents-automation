import express, { type Router } from "express";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { validateBody } from "~/server/middleware/validateBody";
import { getInstallationById } from "~/server/util/routes/installation";
import { listMembersForInstallation } from "~/server/util/routes/installationMember";
import {
  inviteMemberToInstallation,
  updateInstallationMemberRole,
  revokeInstallationMember,
} from "~/server/util/services/installationMemberService";
import {
  InviteMemberSchema,
  UpdateMemberSchema,
} from "~/shared/schemas/installationMember";

export const router: Router = express.Router();

router.use(resolveActorMiddleware);

router.get(
  "/",
  requirePermission("installationAdmin.access"),
  async (req, res) => {
    const members = await listMembersForInstallation(req.actor!.installationId);
    res.json({ members });
  },
);

router.post(
  "/invite",
  requirePermission("installationAdmin.inviteMember"),
  validateBody(InviteMemberSchema),
  async (req, res, next) => {
    try {
      const installation = await getInstallationById(req.actor!.installationId);
      const created = await inviteMemberToInstallation({
        installationId: req.actor!.installationId,
        installationName: installation?.name ?? "your installation",
        actorRole: req.actor!.role,
        email: req.body.email,
        role: req.body.role,
        scope: req.body.scope,
        origin: `${req.protocol}://${req.get("host")}`,
      });
      res.status(201).json({ member: created });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:id",
  requirePermission("installationAdmin.updateMember"),
  validateBody(UpdateMemberSchema),
  async (req, res, next) => {
    try {
      await updateInstallationMemberRole({
        installationId: req.actor!.installationId,
        actorRole: req.actor!.role,
        memberId: req.params.id as string,
        role: req.body.role,
        scope: req.body.scope,
      });
      res.status(200).json({ message: "Updated." });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id",
  requirePermission("installationAdmin.revokeMember"),
  async (req, res, next) => {
    try {
      await revokeInstallationMember({
        installationId: req.actor!.installationId,
        memberId: req.params.id as string,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
