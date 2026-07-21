import assert from "node:assert/strict";
import test from "node:test";
import { UserInputError } from "../dist/config.js";
import { sanitizeError } from "../dist/errors.js";

test("sanitizes SP-API responses without surfacing raw messages or tokens", () => {
  const result = sanitizeError({
    message: "request failed with refresh-token-secret",
    status: 403,
    response: {
      headers: {
        "x-amzn-requestid": "request-123",
        authorization: "Bearer access-token-secret",
      },
      body: "private order data",
    },
  });
  const serialized = JSON.stringify(result);
  assert.deepEqual(result, {
    error: "Amazon SP-API access was denied",
    statusCode: 403,
    requestId: "request-123",
    retryable: false,
  });
  assert.doesNotMatch(
    serialized,
    /refresh-token-secret|access-token-secret|private order data/,
  );
});

test("marks throttling and service failures as retryable", () => {
  assert.equal(sanitizeError({ statusCode: 429 }).retryable, true);
  assert.equal(sanitizeError({ response: { status: 503 } }).retryable, true);
  assert.equal(sanitizeError(new Error("network failure")).retryable, false);
});

test("preserves only controlled user input errors", () => {
  assert.deepEqual(sanitizeError(new UserInputError("Choose one filter")), {
    error: "Choose one filter",
    retryable: false,
  });
});
