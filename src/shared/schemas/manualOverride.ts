import { z } from "zod";

// Hold-duration options from ZoneDetailDialog's manual slider/stepper.
export const HOLD_TYPES = [
  "2h",
  "4h",
  "until_next_event",
  "permanent",
] as const;
export type HoldType = (typeof HOLD_TYPES)[number];

const baseFields = {
  hold_type: z.enum(HOLD_TYPES),
  // Free-text display name, not a real user id — see "The 'who' in 'logged
  // clearly'" in the implementation plan (no auth yet; per-browser
  // localStorage-sourced name, same mechanism as theme/Diagnostic Mode).
  actor: z.string().min(1),
  note: z.string().optional(),
};

// `kind` discriminates what `value` actually is and what it bypasses — a
// setpoint override replaces the resolved target and flows through Steps
// 1–3 normally; a position override goes straight to the vent, bypassing
// Steps 1–3's position math for that zone only (setpoint resolution keeps
// running independently). See "Comfort tolerance & target resolution
// order" in the plan.
export const manualOverrideConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setpoint"), value: z.number(), ...baseFields }),
  z.object({
    kind: z.literal("position"),
    value: z.number().min(0).max(100),
    ...baseFields,
  }),
]);

export type ManualOverrideConfig = z.infer<typeof manualOverrideConfigSchema>;

export function resolveManualOverrideConfig(
  stored: unknown,
): ManualOverrideConfig {
  return manualOverrideConfigSchema.parse(stored);
}
