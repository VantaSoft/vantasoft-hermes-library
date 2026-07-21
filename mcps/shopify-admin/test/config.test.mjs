import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getStore,
  listSafeStores,
  loadConfig,
  resolveCredentialsFile,
} from "../dist/config.js";

function fixture() {
  return {
    defaultStore: "primary",
    stores: {
      primary: {
        shopDomain: "primary.myshopify.com",
        accessToken: "static-token",
        apiVersion: "2026-07",
      },
    },
  };
}

test("resolves explicit, Hermes, and portable credential paths", () => {
  assert.equal(
    resolveCredentialsFile({ SHOPIFY_CREDENTIALS_FILE: "/tmp/shopify.json" }),
    "/tmp/shopify.json",
  );
  assert.equal(
    resolveCredentialsFile({ HERMES_HOME: "/tmp/profile" }),
    "/tmp/profile/mcp-tokens/shopify-admin/credentials.json",
  );
  assert.match(resolveCredentialsFile({}), /vantasoft-mcps\/shopify-admin/);
});

test("loads credentials and restricts directory and file permissions", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopify-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(file, JSON.stringify(fixture()), { mode: 0o644 });
  const config = loadConfig(file);
  assert.equal(config.defaultStore, "primary");
  assert.equal(config.stores.primary.apiVersion, "2026-07");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("rejects unsafe domains and ambiguous authentication", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopify-invalid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  const unsafe = fixture();
  unsafe.stores.primary.shopDomain = "attacker.example";
  fs.writeFileSync(file, JSON.stringify(unsafe));
  assert.throws(() => loadConfig(file), /shopDomain/);

  const ambiguous = fixture();
  ambiguous.stores.primary.clientId = "client";
  ambiguous.stores.primary.clientSecret = "secret";
  fs.writeFileSync(file, JSON.stringify(ambiguous));
  assert.throws(() => loadConfig(file), /either accessToken/);
});

test("safe store listing omits all authentication values", () => {
  const config = fixture();
  const serialized = JSON.stringify(listSafeStores(config));
  assert.match(serialized, /primary\.myshopify\.com/);
  assert.doesNotMatch(serialized, /"accessToken"|"clientSecret"|"clientId"/);
  assert.equal(getStore(config, "primary").name, "primary");
  assert.throws(() => getStore(config, "missing"), /Unknown Shopify store/);
});
