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
      SP_API_CREDENTIALS_FILE: file,
      SP_API_ENABLE_MUTATIONS: enableMutations ? "true" : "false",
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
  const client = new Client({ name: "amazon-sp-api-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

test("stdio MCP starts with read-only tools and no live Amazon request", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spapi-smoke-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      defaultStore: "smoke",
      stores: {
        smoke: {
          clientId: "not-a-live-client",
          clientSecret: "not-a-live-secret",
          refreshToken: "not-a-live-token",
          sellerId: "not-a-live-seller",
          region: "NA",
          marketplaceId: "ATVPDKIKX0DER",
          sandbox: true,
        },
      },
    }),
    { mode: 0o600 },
  );

  const tools = await listTools(file, false);
  const names = tools.map((tool) => tool.name);
  assert.equal(tools.length, 27);
  assert.equal(names.includes("spapi_get_fba_inventory"), true);
  assert.equal(names.includes("spapi_patch_listing"), false);
  assert.equal(names.includes("spapi_send_review_solicitation"), false);
});

test("mutation opt-in changes only the exposed tool catalog", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spapi-mutate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      stores: {
        smoke: {
          clientId: "not-a-live-client",
          clientSecret: "not-a-live-secret",
          refreshToken: "not-a-live-token",
          sellerId: "not-a-live-seller",
          region: "NA",
          marketplaceId: "ATVPDKIKX0DER",
        },
      },
    }),
    { mode: 0o600 },
  );

  const tools = await listTools(file, true);
  const names = tools.map((tool) => tool.name);
  assert.equal(tools.length, 29);
  assert.equal(names.includes("spapi_patch_listing"), true);
  assert.equal(names.includes("spapi_send_review_solicitation"), true);
});
