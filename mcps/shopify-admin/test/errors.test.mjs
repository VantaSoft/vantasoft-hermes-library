import assert from "node:assert/strict";
import test from "node:test";
import { UserInputError } from "../dist/config.js";
import { sanitizeError } from "../dist/errors.js";

test("sanitizes network and GraphQL errors", () => {
  const result = sanitizeError({
    networkStatusCode: 403,
    message: "access-token-secret",
    response: { body: "private customer data" },
  });
  assert.deepEqual(result, {
    error: "Shopify API access was denied",
    statusCode: 403,
    retryable: false,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /access-token-secret|private customer data/,
  );
});

test("marks rate limits and server failures retryable", () => {
  assert.equal(sanitizeError({ statusCode: 429 }).retryable, true);
  assert.equal(sanitizeError({ response: { status: 503 } }).retryable, true);
});

test("preserves only controlled user input errors", () => {
  assert.deepEqual(sanitizeError(new UserInputError("Choose a valid store")), {
    error: "Choose a valid store",
    retryable: false,
  });
});
