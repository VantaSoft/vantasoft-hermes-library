import assert from "node:assert/strict";
import test from "node:test";
import { AccessTokenProvider } from "../dist/access-token-provider.js";

const staticConfig = {
  defaultStore: "primary",
  stores: {
    primary: {
      shopDomain: "primary.myshopify.com",
      accessToken: "static-token",
      apiVersion: "2026-07",
    },
  },
};

const clientConfig = {
  defaultStore: "primary",
  stores: {
    primary: {
      shopDomain: "primary.myshopify.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      apiVersion: "2026-07",
    },
  },
};

test("returns static access tokens without making a network request", async () => {
  const provider = new AccessTokenProvider(staticConfig, async () => {
    throw new Error("fetch must not run");
  });
  const selected = await provider.get();
  assert.equal(selected.accessToken, "static-token");
  assert.equal(selected.store.shopDomain, "primary.myshopify.com");
});

test("uses Shopify client credentials and caches the expiring token", async () => {
  const requests = [];
  const provider = new AccessTokenProvider(clientConfig, async (url, init) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({ access_token: "temporary-token", expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  assert.equal((await provider.get()).accessToken, "temporary-token");
  assert.equal((await provider.get()).accessToken, "temporary-token");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://primary.myshopify.com/admin/oauth/access_token",
  );
  assert.equal(requests[0].init.redirect, "error");
  const body = requests[0].init.body;
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_secret"), "client-secret");
});

test("token failures expose only an HTTP status", async () => {
  const provider = new AccessTokenProvider(
    clientConfig,
    async () => new Response("private response", { status: 401 }),
  );
  await assert.rejects(
    () => provider.get(),
    (error) =>
      error.statusCode === 401 && !JSON.stringify(error).includes("private"),
  );
});
