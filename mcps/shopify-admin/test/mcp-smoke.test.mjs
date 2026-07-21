import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function environment(file, enableMutations) {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      SHOPIFY_CREDENTIALS_FILE: file,
      SHOPIFY_ENABLE_MUTATIONS: enableMutations ? "true" : "false",
    }).filter((entry) => typeof entry[1] === "string"),
  );
}

async function listTools(file, enableMutations) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: environment(file, enableMutations),
    stderr: "pipe",
  });
  const client = new Client({ name: "shopify-admin-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

function credentialFixture(file) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      defaultStore: "smoke",
      stores: {
        smoke: {
          shopDomain: "smoke-test.myshopify.com",
          accessToken: "not-a-live-token",
          apiVersion: "2026-07",
        },
      },
    }),
    { mode: 0o600 },
  );
}

test("stdio MCP starts read-only without making a Shopify request", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopify-smoke-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  credentialFixture(file);
  const tools = await listTools(file, false);
  const names = tools.map((tool) => tool.name);
  assert.equal(tools.length, 22);
  assert.equal(names.includes("shopify_list_products"), true);
  assert.equal(names.includes("shopify_set_inventory"), false);
});

test("mutation opt-in changes only the exposed tool catalog", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopify-write-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  credentialFixture(file);
  const tools = await listTools(file, true);
  const names = tools.map((tool) => tool.name);
  assert.equal(tools.length, 28);
  assert.equal(names.includes("shopify_create_product"), true);
  assert.equal(names.includes("shopify_set_metafields"), true);
  assert.equal(
    names.some((name) => /delete|refund|cancel/i.test(name)),
    false,
  );
});
