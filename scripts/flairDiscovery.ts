// Phase 0 — live Flair API discovery. Read-only: authenticates, fetches
// structures/rooms/vents, and dumps full raw JSON:API payloads plus a
// checklist-driven analysis pass. Never writes anything — see the plan's
// Phase 0 section for why a write test is handled as a separate, deliberate
// step, not part of this script. Run with:
//   bun run scripts/flairDiscovery.ts
import { getTokenWithClientCredentials } from "~/server/util/auth";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { upsertFlairToken } from "~/server/util/routes/flairToken";

function baseUrl(): string {
  return process.env.FLAIR_API_BASE_URL || "https://api.flair.co";
}

async function authenticate(): Promise<string> {
  const grantMode = process.env.FLAIR_GRANT_MODE || "client_credentials";
  console.log(`Authenticating via ${grantMode}...`);
  if (grantMode !== "client_credentials") {
    throw new Error(
      `flairDiscovery.ts currently only drives client_credentials directly — FLAIR_GRANT_MODE=${grantMode} needs the browser-based getNewFlairToken.ts flow first, then re-run this against the persisted token.`,
    );
  }
  const response = await getTokenWithClientCredentials();
  const bodyText = await response.text();
  if (!response.ok) {
    console.error(`Token request failed: ${response.status} ${response.statusText}`);
    console.error(bodyText);
    process.exit(1);
  }
  const tokenData = JSON.parse(bodyText) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };
  console.log("Token minted successfully.");
  console.log(`  expires_in: ${tokenData.expires_in}s`);
  console.log(`  scope: ${tokenData.scope ?? "(not returned)"}`);
  console.log(`  token_type: ${tokenData.token_type ?? "(not returned)"}`);
  console.log(`  refresh_token present: ${Boolean(tokenData.refresh_token)}`);

  const installation = await getOrCreateDefaultInstallation();
  await upsertFlairToken({
    installationId: installation.id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    scope: tokenData.scope ?? null,
  });
  console.log("Token persisted to flair_tokens.");

  return tokenData.access_token;
}

async function get(token: string, path: string): Promise<{ status: number; body: unknown; headers: Headers }> {
  const url = new URL(path, baseUrl()).toString();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.api+json",
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function section(title: string): void {
  console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
}

async function main(): Promise<void> {
  const token = await authenticate();

  section("GET /api/structures");
  const structuresResult = await get(token, "/api/structures");
  console.log(`status: ${structuresResult.status}`);
  console.log(JSON.stringify(structuresResult.body, null, 2));

  if (structuresResult.status !== 200) {
    console.error("\nCould not fetch structures — stopping here. Check credentials/scope above.");
    process.exit(1);
  }

  const structures = (structuresResult.body as { data?: Array<{ id: string; attributes: Record<string, unknown> }> }).data ?? [];
  console.log(`\nFound ${structures.length} structure(s).`);

  for (const structure of structures) {
    section(`GET /api/structures/${structure.id}/rooms`);
    const roomsResult = await get(token, `/api/structures/${structure.id}/rooms`);
    console.log(`status: ${roomsResult.status}`);
    console.log(JSON.stringify(roomsResult.body, null, 2));

    section(`GET /api/structures/${structure.id}/vents`);
    const ventsResult = await get(token, `/api/structures/${structure.id}/vents`);
    console.log(`status: ${ventsResult.status}`);
    console.log(JSON.stringify(ventsResult.body, null, 2));

    section(`GET /api/structures/${structure.id}/thermostats (if this relation exists)`);
    const thermostatsResult = await get(token, `/api/structures/${structure.id}/thermostats`);
    console.log(`status: ${thermostatsResult.status}`);
    console.log(JSON.stringify(thermostatsResult.body, null, 2));

    section(`GET /api/structures/${structure.id}/pucks (if this relation exists)`);
    const pucksResult = await get(token, `/api/structures/${structure.id}/pucks`);
    console.log(`status: ${pucksResult.status}`);
    console.log(JSON.stringify(pucksResult.body, null, 2));

    section(`GET /api/structures/${structure.id}/zones`);
    const zonesResult = await get(token, `/api/structures/${structure.id}/zones`);
    console.log(`status: ${zonesResult.status}`);
    console.log(JSON.stringify(zonesResult.body, null, 2));

    section(`GET /api/structures/${structure.id}/current-state`);
    const structureStateResult = await get(token, `/api/structures/${structure.id}/current-state`);
    console.log(`status: ${structureStateResult.status}`);
    console.log(JSON.stringify(structureStateResult.body, null, 2));
  }

  // One representative vent/room/thermostat/remote-sensor's sub-resources —
  // not looped over every one, just enough to see the shape.
  const roomsForSubResourceCheck = (
    (await get(token, `/api/structures/${structures[0]?.id}/rooms`)).body as {
      data?: Array<{ id: string; relationships: Record<string, { data?: unknown }> }>;
    }
  ).data ?? [];
  const ventsForSubResourceCheck = (
    (await get(token, `/api/structures/${structures[0]?.id}/vents`)).body as {
      data?: Array<{ id: string }>;
    }
  ).data ?? [];
  const thermostatsForSubResourceCheck = (
    (await get(token, `/api/structures/${structures[0]?.id}/thermostats`)).body as {
      data?: Array<{ id: string }>;
    }
  ).data ?? [];

  if (ventsForSubResourceCheck[0]) {
    const ventId = ventsForSubResourceCheck[0].id;
    section(`GET /api/vents/${ventId}/current-reading`);
    console.log(JSON.stringify((await get(token, `/api/vents/${ventId}/current-reading`)).body, null, 2));
    section(`GET /api/vents/${ventId}/current-state`);
    console.log(JSON.stringify((await get(token, `/api/vents/${ventId}/current-state`)).body, null, 2));
  }

  if (thermostatsForSubResourceCheck[0]) {
    const thermostatId = thermostatsForSubResourceCheck[0].id;
    section(`GET /api/thermostats/${thermostatId}/current-state`);
    console.log(JSON.stringify((await get(token, `/api/thermostats/${thermostatId}/current-state`)).body, null, 2));
    section(`GET /api/thermostats/${thermostatId}/remote-sensor`);
    console.log(JSON.stringify((await get(token, `/api/thermostats/${thermostatId}/remote-sensor`)).body, null, 2));
  }

  const roomWithRemoteSensor = roomsForSubResourceCheck.find(
    (r) => (r.relationships["remote-sensors"]?.data as unknown[] | undefined)?.length,
  );
  if (roomWithRemoteSensor) {
    section(`GET /api/rooms/${roomWithRemoteSensor.id}/remote-sensors`);
    console.log(JSON.stringify((await get(token, `/api/rooms/${roomWithRemoteSensor.id}/remote-sensors`)).body, null, 2));
    section(`GET /api/rooms/${roomWithRemoteSensor.id}/current-state`);
    console.log(JSON.stringify((await get(token, `/api/rooms/${roomWithRemoteSensor.id}/current-state`)).body, null, 2));
  }

  section("Phase 0 checklist — fields to eyeball in the raw dumps above");
  console.log(`
  [ ] Real-time equipment call state field (vs. configured mode)
  [ ] Stage/modulation data field
  [ ] Equipment fault field
  [ ] set-point-temperature-c present on structures, confirm rounding granularity
  [ ] Per-room setpoint/hold field, distinct from structure-level setpoint
  [ ] Ecobee-sourced Home/Away visibility
  [ ] Active comfort-setting sensor group — present? writable?
  [ ] Per-room sensor identity/source (which physical sensor is this reading from)
  [ ] Per-reading "last updated" timestamp, distinct from response/poll time
  [ ] Genuinely-fresh-vs-cached-value distinguishability
  [ ] Force-fresh-read capability (a param or endpoint that bypasses caching)
  [ ] Single vs. per-handler "structures" modeling — does one structure = one air handler?
  [ ] How "rooms" distinguishes vent vs. puck-only vs. neither
  [ ] Battery/RSSI fields on vents (needed for Phase 3 HardwareDiagnostics)
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
