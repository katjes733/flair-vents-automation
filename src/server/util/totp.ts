// otp-io's own HmacAlgorithm enum (src/crypto/hmac.ts) passes lowercase,
// hyphen-less names ("sha1", "sha256", "sha512") — Web Crypto's
// SubtleCrypto requires the standard "SHA-1"/"SHA-256"/"SHA-512" form and
// rejects anything else with "Unrecognized algorithm name". Confirmed live
// (not assumed): the un-normalized form throws under this project's own
// test runner even though otp-io's own README examples don't surface it.
function toWebCryptoAlgorithmName(algorithm: string): string {
  const match = /^sha(\d+)$/i.exec(algorithm);
  return match ? `SHA-${match[1]}` : algorithm;
}

// The HMAC implementation otp-io's totp()/generateKey() need, using Web
// Crypto rather than Node's legacy crypto HMAC API.
export async function hmac(
  algorithm: string,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: { name: toWebCryptoAlgorithmName(algorithm) } },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    message as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(signature);
}
