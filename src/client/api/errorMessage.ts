/** Extracts the server's own error message from an axios error, if present. */
export function extractErrorMessage(err: unknown): string | null {
  if (
    err &&
    typeof err === "object" &&
    "response" in err &&
    typeof (err as { response?: unknown }).response === "object"
  ) {
    const response = (err as { response?: { data?: { error?: unknown } } })
      .response;
    const message = response?.data?.error;
    if (typeof message === "string") return message;
  }
  return null;
}
