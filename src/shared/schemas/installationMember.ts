import { z } from "zod";

// Deliberately excludes "owner" from a bare enum — inviting/promoting to
// owner is allowed, but only for an actor who is already an owner
// themselves (a role-comparison rule, not an ActionSchema leaf — see
// installationMemberService.ts). The schema accepts all four roles; the
// service layer is what enforces the extra restriction on "owner"
// specifically.
export const InstallationMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "write",
  "read",
]);

// "*" (every air handler) is the only option this app's UI offers today —
// see the SaaS Transformation plan's own "Delegate and Multi-User Access"
// section for why a finer-grained air-handler picker is a real, deferred
// follow-up, not an oversight: most installations have exactly one air
// handler, so building that picker now would be UI complexity with no
// installation actually needing it yet.
export const InstallationMemberScopeSchema = z.object({
  air_handler_ids: z.union([z.array(z.string()), z.literal("*")]),
});

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: InstallationMemberRoleSchema,
  scope: InstallationMemberScopeSchema.optional(),
});

export const UpdateMemberSchema = z.object({
  role: InstallationMemberRoleSchema.optional(),
  scope: InstallationMemberScopeSchema.optional(),
});

// The invite-acceptance flow's own single-step activation — a verification
// code (sent when the invite was created, or via a plain /auth/send-code
// resend) plus the invitee's chosen password. Deliberately not a 2-request
// verify-then-set-password flow like self-signup's: there's no "connect
// Flair" step to sequence afterward, so there's nothing to gain from
// splitting it.
export const ActivateInviteSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
  password: z.string().min(8),
});

export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type ActivateInviteInput = z.infer<typeof ActivateInviteSchema>;
