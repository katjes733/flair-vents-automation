import {
  getTokenWithClientCredentials,
  type FlairCredentials,
} from "~/server/util/auth";
import { HttpError } from "~/server/util/httpError";
import type { FlairStructure } from "~/server/util/flair/client";

function baseUrl(): string {
  return process.env.FLAIR_API_BASE_URL || "https://api.flair.co";
}

export interface ValidatedFlairCredentials {
  accessToken: string;
  expiresAt: Date;
  scope: string | null;
  structure: FlairStructure;
}

// Validates a freshly-submitted BYO Flair Client ID/Secret pair BEFORE any
// installation/user/membership row is ever created — see the SaaS
// Transformation plan's "Flair BYO-Credentials Onboarding" section for why
// this ordering (live-validate, THEN commit) is the load-bearing part of
// the whole flow. Deliberately standalone rather than routing through
// FlairApiClient: that class is keyed to an already-existing installationId
// with its own flair_tokens row, neither of which exists yet at this point.
export async function validateFlairCredentials(
  credentials: FlairCredentials,
): Promise<ValidatedFlairCredentials> {
  let tokenResponse: Response;
  try {
    tokenResponse = await getTokenWithClientCredentials(credentials);
  } catch {
    throw new HttpError(
      "Couldn't reach Flair to validate those credentials. Please try again.",
      502,
    );
  }
  if (!tokenResponse.ok) {
    throw new HttpError(
      "That Client ID/Secret didn't work — double-check you copied both fully from your Flair app's Account Settings → Developer Settings screen.",
      400,
    );
  }
  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  const structuresResponse = await fetch(
    new URL("/api/structures", baseUrl()).toString(),
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.api+json",
      },
    },
  );
  if (!structuresResponse.ok) {
    throw new HttpError(
      "Connected to Flair, but couldn't read your account's structures. Please try again.",
      400,
    );
  }
  const body = (await structuresResponse.json()) as {
    data: Array<{ id: string; attributes: Record<string, unknown> }>;
  };
  const structures: FlairStructure[] = body.data.map((d) => ({
    id: d.id,
    name: String(d.attributes.name ?? ""),
    timeZone: (d.attributes["time-zone"] as string | undefined) ?? null,
  }));

  // Same enforcement, same error messages, as installationService.ts's own
  // ensureFlairStructureLinked — kept in sync deliberately since both
  // guard the identical "exactly one structure" invariant, just at
  // different points in an installation's lifecycle (this one before it
  // exists at all).
  if (structures.length === 0) {
    throw new HttpError("No Flair structures found on this account.", 400);
  }
  if (structures.length > 1) {
    throw new HttpError(
      "Multiple Flair structures found on this account — automatic linking isn't supported for more than one.",
      400,
    );
  }

  return {
    accessToken: tokenData.access_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    scope: tokenData.scope ?? null,
    structure: structures[0],
  };
}
