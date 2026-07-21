import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(testDirectory, "../dist/index.js");

test("starts over stdio with a read-only QuickBooks tool catalog", async () => {
  const hermesHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "quickbooks-mcp-home-"),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      QUICKBOOKS_CLIENT_ID: "test-client-id",
      QUICKBOOKS_CLIENT_SECRET: "test-client-secret",
      QUICKBOOKS_REFRESH_TOKEN: "test-refresh-token",
      QUICKBOOKS_REALM_ID: "test-realm-id",
      QUICKBOOKS_ENVIRONMENT: "sandbox",
      QUICKBOOKS_ENABLE_MUTATIONS: "false",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "quickbooks-mcp-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));

    for (const expected of [
      "get_company_info",
      "get_profit_and_loss",
      "get_balance_sheet",
      "get_general_ledger",
      "search_customers",
      "search_invoices",
      "search_bills",
      "search_accounts",
    ]) {
      assert.ok(toolNames.has(expected), `missing MCP tool: ${expected}`);
    }

    for (const tool of tools) {
      assert.doesNotMatch(
        tool.name,
        /^(create|update|delete)[_-]/,
        `mutation exposed without opt-in: ${tool.name}`,
      );
    }
  } finally {
    await client.close();
    fs.rmSync(hermesHome, { recursive: true, force: true });
  }
});
