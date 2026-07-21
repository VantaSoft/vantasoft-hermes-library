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

test("registers 22 curated read tools by default", () => {
  const { handlers, annotations } = registry(false, { listStores: () => [] });
  assert.equal(handlers.size, 22);
  assert.equal(handlers.has("shopify_get_shop"), true);
  assert.equal(handlers.has("shopify_set_inventory"), false);
  assert.equal(
    [...handlers.keys()].some((name) =>
      /delete|refund|cancel|complete|mark_paid|create_fulfillment/i.test(name),
    ),
    false,
  );
  assert.equal(annotations.get("shopify_list_products").readOnlyHint, true);
});

test("adds six clearly labeled mutations only after opt-in", () => {
  const { handlers, descriptions, annotations } = registry(true, {
    listStores: () => [],
  });
  assert.equal(handlers.size, 28);
  for (const name of [
    "shopify_create_product",
    "shopify_update_product",
    "shopify_set_inventory",
    "shopify_add_tags",
    "shopify_remove_tags",
    "shopify_set_metafields",
  ]) {
    assert.equal(handlers.has(name), true);
    assert.match(descriptions.get(name), /^MUTATION:/);
    assert.equal(annotations.get(name).readOnlyHint, false);
  }
  assert.equal(annotations.get("shopify_set_inventory").destructiveHint, true);
});

test("handlers serialize successful results and sanitize failures", async () => {
  const success = registry(false, { listStores: () => [{ name: "primary" }] });
  const ok = await success.handlers.get("shopify_list_stores")({});
  assert.match(ok.content[0].text, /primary/);

  const failed = registry(false, {
    getShop: async () => {
      throw {
        networkStatusCode: 403,
        message: "access-token-secret",
        response: { body: "private shop data" },
      };
    },
  });
  const error = await failed.handlers.get("shopify_get_shop")({});
  assert.equal(error.isError, true);
  assert.match(error.content[0].text, /access was denied/);
  assert.doesNotMatch(
    error.content[0].text,
    /access-token-secret|private shop/,
  );
});
