import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApiClient } from "@shopify/admin-api-client";

test("pinned official Shopify client exposes the Admin GraphQL request contract", () => {
  assert.equal(typeof createAdminApiClient, "function");
  const client = createAdminApiClient({
    storeDomain: "shape-test.myshopify.com",
    apiVersion: "2026-07",
    accessToken: "not-a-live-token",
  });
  assert.equal(typeof client.request, "function");
  assert.equal(typeof client.getApiUrl, "function");
  assert.equal(
    client.getApiUrl(),
    "https://shape-test.myshopify.com/admin/api/2026-07/graphql.json",
  );
});
