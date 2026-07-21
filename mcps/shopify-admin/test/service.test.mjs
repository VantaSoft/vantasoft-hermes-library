import assert from "node:assert/strict";
import test from "node:test";
import { ShopifyService } from "../dist/shopify-service.js";

const config = {
  defaultStore: "primary",
  stores: {
    primary: {
      shopDomain: "primary.myshopify.com",
      accessToken: "static-token",
      apiVersion: "2026-07",
    },
  },
};

function serviceWith(responseFactory = () => ({ data: { ok: true } })) {
  const calls = [];
  const clients = [];
  const tokens = {
    get: async () => ({
      name: "primary",
      store: config.stores.primary,
      accessToken: "static-token",
    }),
  };
  const service = new ShopifyService(config, tokens, (clientConfig) => {
    clients.push(clientConfig);
    return async (operation, options) => {
      calls.push({ operation, variables: options?.variables });
      return responseFactory(operation, options);
    };
  });
  return { service, calls, clients };
}

test("maps product searches through Shopify's official client contract", async () => {
  const { service, calls, clients } = serviceWith();
  await service.listProducts({ query: "status:active", first: 10 });
  assert.equal(clients[0].storeDomain, "primary.myshopify.com");
  assert.equal(clients[0].apiVersion, "2026-07");
  assert.equal(clients[0].accessToken, "static-token");
  assert.match(calls[0].operation, /query Products/);
  assert.deepEqual(calls[0].variables, {
    first: 10,
    after: undefined,
    query: "status:active",
    reverse: false,
  });
});

test("returns query-cost information but not client or response internals", async () => {
  const { service } = serviceWith(() => ({
    data: { shop: { id: "gid://shopify/Shop/1" } },
    extensions: { cost: { actualQueryCost: 1 }, context: { private: true } },
  }));
  const result = await service.getShop();
  assert.deepEqual(result, {
    data: { shop: { id: "gid://shopify/Shop/1" } },
    cost: { actualQueryCost: 1 },
  });
});

test("redacts Shopify user-error messages while preserving field paths", async () => {
  const { service } = serviceWith(() => ({
    data: {
      productUpdate: {
        product: null,
        userErrors: [
          { field: ["product", "title"], message: "secret submitted title" },
        ],
      },
    },
  }));
  await assert.rejects(
    () => service.updateProduct({ id: "gid://shopify/Product/1", title: "x" }),
    (error) =>
      error.message === "Shopify rejected the mutation at product.title" &&
      !error.message.includes("secret submitted title"),
  );
});

test("creates products as drafts and requires inventory compare quantities", async () => {
  const { service, calls } = serviceWith();
  await service.createProduct({ title: "Draft item" });
  await service.setInventory({
    name: "available",
    reason: "correction",
    referenceDocumentUri: "gid://vantasoft/InventoryChange/1",
    quantities: [
      {
        inventoryItemId: "gid://shopify/InventoryItem/1",
        locationId: "gid://shopify/Location/2",
        quantity: 10,
        compareQuantity: 8,
      },
    ],
  });
  assert.equal(calls[0].variables.product.status, "DRAFT");
  assert.equal(calls[1].variables.input.quantities[0].compareQuantity, 8);
});

test("turns official client errors into status-only failures", async () => {
  const { service } = serviceWith(() => ({
    errors: {
      networkStatusCode: 401,
      message: "raw token-bearing error",
      response: { body: "private" },
    },
  }));
  await assert.rejects(
    () => service.getShop(),
    (error) =>
      error.networkStatusCode === 401 &&
      !JSON.stringify(error).includes("raw token-bearing error"),
  );
});
