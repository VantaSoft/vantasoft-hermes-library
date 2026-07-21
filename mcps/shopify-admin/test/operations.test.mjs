import assert from "node:assert/strict";
import test from "node:test";
import * as operations from "../dist/operations.js";

test("default order and customer-list queries omit address and direct-contact fields", () => {
  const defaultQueries = [operations.ORDERS_QUERY, operations.ORDER_QUERY];
  for (const query of defaultQueries) {
    assert.doesNotMatch(query, /shippingAddress|billingAddress/);
  }
  assert.doesNotMatch(operations.CUSTOMERS_QUERY, /\bemail\b|\bphone\b/);
  assert.match(operations.CUSTOMER_QUERY, /\bemail\b/);
  assert.doesNotMatch(operations.CUSTOMER_QUERY, /Address/);
  assert.doesNotMatch(operations.WEBHOOKS_QUERY, /\buri\b|callbackUrl/);
});

test("every mutation requests structured user errors", () => {
  const mutations = Object.entries(operations).filter(([name]) =>
    name.endsWith("_MUTATION"),
  );
  assert.equal(mutations.length, 6);
  for (const [name, document] of mutations) {
    assert.match(document, /\bmutation\b/, name);
    assert.match(document, /userErrors\s*\{\s*field\s+message/, name);
  }
});

test("read operations are curated and never accept arbitrary GraphQL text", () => {
  for (const document of Object.values(operations)) {
    assert.match(document, /#graphql/);
    assert.doesNotMatch(document, /X-Shopify-Access-Token|clientSecret/);
  }
});
