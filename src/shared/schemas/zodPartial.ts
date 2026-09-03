import { z } from "zod";

/**
 * Like `schema.partial()`, but also strips each field's own `.default()`
 * first — `.partial()` alone does NOT suppress `.default()`, so an omitted
 * key still gets its default value substituted in once parsed, rather than
 * staying genuinely absent. That silently reintroduces every untouched
 * field at its default once merged onto an existing row (`{...existing,
 * ...patch}`), wiping anything the caller never intended to touch.
 *
 * Found live via `zoneConfigSchema` (see its own `zoneConfigPartialSchema`
 * comment for the full incident) — extracted here once a second schema
 * (`systemSettingsConfigSchema`) needed the identical fix, so the next one
 * doesn't have to rediscover it the hard way.
 *
 * Also accepts an explicit `null` on any field as a "clear this" sentinel,
 * normalized to `undefined` — deliberately applied here, on the *partial*
 * schema only, rather than on the base schemas themselves. `null` is the
 * only way a PATCH can genuinely clear an already-set optional field:
 * sending `undefined` doesn't work, because `JSON.stringify` silently
 * drops keys whose value is `undefined` before the request ever leaves
 * the browser, so the key would never reach the server at all and a
 * `{...existing, ...patch}` merge would leave the stale value in place
 * (confirmed live: converting a zone away from `manual_fixed_vent` needs
 * to clear its `assumed_fixed_position`, or the very next save fails
 * validateConfig's "only applies to manual_fixed_vent zones" rule). Doing
 * this inside `genuinePartial()` instead of on the base schema (e.g.
 * `zoneConfigSchema`) matters for a subtler reason too: wrapping a field
 * in `.transform()` makes Zod infer its key as *always present* (type
 * `T | undefined`) rather than genuinely optional, which would silently
 * make `assumed_fixed_position` a required key on the base `ZoneConfig`
 * type and break every object literal across the codebase that omits it.
 * The base schemas' own inferred types (`ZoneConfig`,
 * `SystemSettingsConfig`) are used pervasively as literal-construction
 * types; a partial schema's inferred type here is not — every caller
 * treats a parsed PATCH body as `Partial<...>` by hand rather than
 * relying on this function's own inference, which is what makes it safe
 * to apply this transform universally, on every field, only here.
 */
export function genuinePartial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) {
  return z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([key, rawFieldSchema]) => {
        // Cast to the full ZodTypeAny surface — z.ZodRawShape's value type
        // is the minimal internal $ZodType, which doesn't expose
        // `.optional()`/`.removeDefault()` even though every real field
        // schema is a concrete ZodType instance that has them.
        const fieldSchema = rawFieldSchema as z.ZodTypeAny;
        const withoutDefault =
          fieldSchema instanceof z.ZodDefault
            ? (fieldSchema as z.ZodDefault<z.ZodTypeAny>).removeDefault()
            : fieldSchema;
        return [
          key,
          withoutDefault
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
        ];
      }),
    ),
  );
}
