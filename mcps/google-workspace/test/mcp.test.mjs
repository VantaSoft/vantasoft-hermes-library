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

test("starts over stdio and exposes the Google Workspace tool catalog", async () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "google-workspace-mcp-home-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, HERMES_HOME: hermesHome },
    stderr: "pipe",
  });
  const client = new Client({ name: "google-workspace-mcp-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));

    for (const expected of [
      "gw_status",
      "gw_list_accounts",
      "gmail_search",
      "gcal_list_events",
      "gdrive_search",
      "gdoc_create",
      "gsheet_create",
    ]) {
      assert.ok(toolNames.has(expected), `missing MCP tool: ${expected}`);
    }

    const accountParameter = tools.find((tool) => tool.name === "gmail_search")
      ?.inputSchema.properties?.account;
    assert.ok(accountParameter, "Gmail tools must expose optional account selection");

    const result = await client.callTool({ name: "gw_list_accounts", arguments: {} });
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    assert.match(text, /No accounts configured/);
  } finally {
    await client.close();
    fs.rmSync(hermesHome, { recursive: true, force: true });
  }
});
