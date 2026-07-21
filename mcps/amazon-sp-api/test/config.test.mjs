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
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        sellerId: "seller-id",
        region: "NA",
        marketplaceId: "ATVPDKIKX0DER",
        sandbox: false,
      },
    },
  };
}

test("resolves explicit and Hermes profile-local credential paths", () => {
  assert.equal(
    resolveCredentialsFile({ SP_API_CREDENTIALS_FILE: "/tmp/sp-api.json" }),
    "/tmp/sp-api.json",
  );
  assert.equal(
    resolveCredentialsFile({ HERMES_HOME: "/tmp/profile" }),
    "/tmp/profile/mcp-tokens/amazon-sp-api/credentials.json",
  );
});

test("loads credentials, applies defaults, and restricts file permissions", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spapi-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(file, JSON.stringify(fixture()), { mode: 0o644 });

  const config = loadConfig(file);
  assert.equal(config.defaultStore, "primary");
  assert.equal(config.stores.primary.sandbox, false);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("rejects invalid JSON and unknown default stores", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spapi-invalid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");

  fs.writeFileSync(file, "not-json");
  assert.throws(() => loadConfig(file), /invalid JSON/);

  const config = fixture();
  config.defaultStore = "missing";
  fs.writeFileSync(file, JSON.stringify(config));
  assert.throws(() => loadConfig(file), /defaultStore/);
});

test("safe store listing never exposes credentials or seller identifiers", () => {
  const config = fixture();
  const stores = listSafeStores(config);
  const serialized = JSON.stringify(stores);
  assert.match(serialized, /primary/);
  assert.doesNotMatch(serialized, /client-secret|refresh-token|seller-id/);
  assert.deepEqual(getStore(config, "primary").name, "primary");
  assert.throws(
    () => getStore(config, "missing"),
    /Unknown Amazon SP-API store/,
  );
});
