import assert from "node:assert/strict";
import test from "node:test";
import { registerTools } from "../dist/tools.js";

function registry(enableMutations, serviceOverrides = {}) {
  const handlers = new Map();
  const descriptions = new Map();
  const annotations = new Map();
  const server = {
    registerTool(name, config, handler) {
      handlers.set(name, handler);
      descriptions.set(name, config.description);
      annotations.set(name, config.annotations);
    },
  };
  const service = new Proxy(serviceOverrides, {
    get(target, property) {
      if (property in target) return target[property];
      return async (args) => ({ method: String(property), args });
    },
  });
  registerTools(server, service, { enableMutations });
  return { handlers, descriptions, annotations };
}

test("registers 27 read and report-workflow tools by default", () => {
  const { handlers, annotations } = registry(false, { listStores: () => [] });
  assert.equal(handlers.size, 27);
  assert.equal(handlers.has("spapi_patch_listing"), false);
  assert.equal(handlers.has("spapi_send_review_solicitation"), false);
  assert.equal(handlers.has("spapi_get_fba_inventory"), true);
  assert.equal(handlers.has("spapi_list_inbound_plans"), true);
  assert.equal(handlers.has("spapi_download_report_document"), true);
  assert.equal(
    [...handlers.keys()].some((name) => /buyer|address/i.test(name)),
    false,
  );
  assert.equal(annotations.get("spapi_get_fba_inventory").readOnlyHint, true);
  assert.equal(annotations.get("spapi_create_report").readOnlyHint, false);
});

test("registers only explicit, clearly labeled mutations when enabled", () => {
  const { handlers, descriptions, annotations } = registry(true, {
    listStores: () => [],
  });
  assert.equal(handlers.size, 29);
  assert.match(descriptions.get("spapi_patch_listing"), /^MUTATION:/);
  assert.match(
    descriptions.get("spapi_send_review_solicitation"),
    /^MUTATION:/,
  );
  assert.equal(annotations.get("spapi_patch_listing").destructiveHint, true);
  assert.equal(
    annotations.get("spapi_send_review_solicitation").idempotentHint,
    false,
  );
});

test("tool handlers serialize results and sanitize failures", async () => {
  const success = registry(false, {
    listStores: () => [{ name: "primary" }],
  });
  const successResult = await success.handlers.get("spapi_list_stores")({});
  assert.match(successResult.content[0].text, /primary/);

  const failure = registry(false, {
    getAccount: async () => {
      throw {
        status: 403,
        message: "refresh-token-secret",
        response: { body: "private seller data" },
      };
    },
  });
  const failureResult = await failure.handlers.get("spapi_get_account")({});
  assert.equal(failureResult.isError, true);
  assert.match(failureResult.content[0].text, /access was denied/);
  assert.doesNotMatch(
    failureResult.content[0].text,
    /refresh-token-secret|private seller data/,
  );
});
