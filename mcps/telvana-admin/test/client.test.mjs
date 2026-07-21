import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeError, TelvanaApiError } from "../dist/errors.js";
import { TelvanaClient } from "../dist/telvana-client.js";

function config() {
  return {
    actor: "markus:test",
    apiKey: "secret-api-key-value",
    auditFile: "/tmp/telvana-audit.jsonl",
    baseUrl: "https://staging.example.test/api",
    environment: "staging",
    mutationsEnabled: false,
    allowMutations: false,
  };
}

test("client authenticates with x-api-key and unwraps structured data", async () => {
  let request;
  const client = new TelvanaClient(config(), async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ data: { id: "agent_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(await client.getAgent("agent_1"), { id: "agent_1" });
  assert.equal(request.url, "https://staging.example.test/api/agent/agent_1");
  assert.equal(request.init.headers["x-api-key"], "secret-api-key-value");
  assert.equal(request.init.method, "GET");
});

test("client sends only approved update fields", async () => {
  let body;
  const client = new TelvanaClient(config(), async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { id: "agent_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  await client.updateInboundPrompt("agent_1", "Safe staging prompt");
  assert.deepEqual(body, { inboundPrompt: "Safe staging prompt" });
});

test("upstream failures are sanitized without response bodies or credentials", async () => {
  const client = new TelvanaClient(
    config(),
    async () =>
      new Response(
        JSON.stringify({
          error: "secret-api-key-value and sensitive upstream payload",
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req-safe-123",
          },
        },
      ),
  );

  let error;
  try {
    await client.getAgent("agent_1");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof TelvanaApiError);
  const safe = sanitizeError(error, "staging", "local-request-id");
  assert.equal(safe.error.code, "AUTHENTICATION_FAILED");
  assert.equal(safe.meta.upstreamRequestId, "req-safe-123");
  assert.equal(JSON.stringify(safe).includes("secret-api-key-value"), false);
  assert.equal(
    JSON.stringify(safe).includes("sensitive upstream payload"),
    false,
  );
});
