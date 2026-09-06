import { z } from "zod";

export const WebauthnRegisterOptionsSchema = z.object({
  nickname: z.string().min(1).max(255).optional(),
});

const AuthenticatorAttachmentSchema = z
  .enum(["platform", "cross-platform"])
  .optional();

export const WebauthnRegisterVerifySchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
    authenticatorData: z.string().optional(),
  }),
  authenticatorAttachment: AuthenticatorAttachmentSchema,
  clientExtensionResults: z.record(z.string(), z.unknown()),
  nickname: z.string().min(1).max(255).optional(),
});

export const WebauthnAuthenticationVerifySchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: AuthenticatorAttachmentSchema,
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

export type WebauthnRegisterOptionsInput = z.infer<
  typeof WebauthnRegisterOptionsSchema
>;
export type WebauthnRegisterVerifyInput = z.infer<
  typeof WebauthnRegisterVerifySchema
>;
export type WebauthnAuthenticationVerifyInput = z.infer<
  typeof WebauthnAuthenticationVerifySchema
>;
