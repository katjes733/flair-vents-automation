const IP_ADDRESS_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// WebAuthn's rpID must be a stable, registrable domain — never derived from
// a per-request Host header (an attacker-controlled header would let a
// forged assertion pass rpID validation) and never a raw IP address (the
// WebAuthn spec/browser platform authenticators reject IP-address rpIDs
// outright, so a LAN deployment reachable only by IP simply cannot offer
// WebAuthn there — this app's own Caddy/DNS-01 hostname, per the SaaS
// Transformation plan's "Passkeys" section, is exactly what sidesteps
// this). Read explicitly from env vars, mirroring the ALLOWED_ORIGINS
// pattern. Ported from tesla-powerwall-automation's own requestOrigin.ts.
export function getWebauthnConfig(): {
  rpID: string;
  expectedOrigin: string[];
} {
  const isDev = process.env.NODE_ENV === "development";
  const rpID = process.env.WEBAUTHN_RP_ID || (isDev ? "localhost" : undefined);
  if (!rpID) {
    throw new Error("WEBAUTHN_RP_ID environment variable is required");
  }
  if (IP_ADDRESS_PATTERN.test(rpID)) {
    throw new Error(
      `WEBAUTHN_RP_ID must be a registrable domain name, not an IP address: "${rpID}"`,
    );
  }

  const expectedOrigin = (
    process.env.WEBAUTHN_EXPECTED_ORIGINS ||
    (isDev ? "https://localhost:5173" : "")
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (expectedOrigin.length === 0) {
    throw new Error(
      "WEBAUTHN_EXPECTED_ORIGINS environment variable is required",
    );
  }

  return { rpID, expectedOrigin };
}
