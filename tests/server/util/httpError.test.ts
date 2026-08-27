import { describe, it, expect } from "vitest";
import { HttpError } from "~/server/util/httpError";

describe("HttpError", () => {
  it("carries the given status and message, and is a real Error", () => {
    const err = new HttpError("origin not allowed", 403);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
    expect(err.message).toBe("origin not allowed");
    expect(err.name).toBe("HttpError");
  });
});
