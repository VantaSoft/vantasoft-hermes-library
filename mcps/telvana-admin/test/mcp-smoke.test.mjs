import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

async function startApi(t) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        apiKey: request.headers["x-api-key"],
        body: raw ? JSON.parse(raw) : undefined,
      });
      const data =
        request.method === "PUT"
          ? { id: "agent_1", inboundPrompt: JSON.parse(raw).inboundPrompt }
          : { id: "agent_1", inboundPrompt: "Staging prompt" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function writeCredentials(directory, baseUrl, allowMutations) {
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      environments: {
        development: {
          baseUrl,
          apiKey: "stdio-secret-key",
          allowMutations,
        },
      },
    }),
    { mode: 0o600 },
  );
  return file;
}

function childEnvironment(credentialsFile, auditFile, enableMutations) {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      TELVANA_CREDENTIALS_FILE: credentialsFile,
      TELVANA_AUDIT_FILE: auditFile,
      TELVANA_ENVIRONMENT: "development",
      TELVANA_MCP_ACTOR: "markus:test",
      TELVANA_ENABLE_MUTATIONS: enableMutations ? "true" : "false",
      TELVANA_ALLOW_PRODUCTION: "false",
    }).filter((entry) => typeof entry[1] === "string"),
  );
}

async function withClient(environment, handler) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "telvana-admin-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await handler(client);
  } finally {
    await client.close();
  }
}

test("stdio MCP discovers only read tools by default and performs an authenticated read", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "telvana-stdio-read-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const api = await startApi(t);
  const credentials = writeCredentials(directory, api.baseUrl, false);
  const auditFile = path.join(directory, "audit.jsonl");

  await withClient(
    childEnvironment(credentials, auditFile, false),
    async (client) => {
      const tools = (await client.listTools()).tools;
      const names = tools.map((tool) => tool.name);
      assert.equal(tools.length, 5);
      assert.equal(names.includes("telvana_get_agent"), true);
      assert.equal(names.includes("telvana_update_inbound_prompt"), false);
      assert.equal(
        names.some((name) => /delete|drop|remove/i.test(name)),
        false,
      );

      const result = parseToolResult(
        await client.callTool({
          name: "telvana_get_agent",
          arguments: { agentId: "agent_1" },
        }),
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.id, "agent_1");
    },
  );

  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].apiKey, "stdio-secret-key");
  assert.equal(api.requests[0].path, "/agent/agent_1");
  const audit = fs.readFileSync(auditFile, "utf8");
  assert.equal(audit.includes("stdio-secret-key"), false);
  assert.equal(audit.includes('"outcome":"success"'), true);
});

test("authorized mutation tools require environment confirmation and audit the outcome", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "telvana-stdio-write-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const api = await startApi(t);
  const credentials = writeCredentials(directory, api.baseUrl, true);
  const auditFile = path.join(directory, "audit.jsonl");

  await withClient(
    childEnvironment(credentials, auditFile, true),
    async (client) => {
      const tools = (await client.listTools()).tools;
      const names = tools.map((tool) => tool.name);
      assert.equal(tools.length, 8);
      assert.equal(names.includes("telvana_update_inbound_prompt"), true);
      assert.equal(
        names.some((name) => /delete|drop|remove/i.test(name)),
        false,
      );

      const mismatchedEnvironment = await client.callTool({
        name: "telvana_update_inbound_prompt",
        arguments: {
          agentId: "agent_1",
          confirmEnvironment: "staging",
          reason: "Mismatched environment test",
          inboundPrompt: "Must not be sent",
        },
      });
      assert.equal(mismatchedEnvironment.isError, true);
      assert.equal(api.requests.length, 0);

      const result = parseToolResult(
        await client.callTool({
          name: "telvana_update_inbound_prompt",
          arguments: {
            agentId: "agent_1",
            confirmEnvironment: "development",
            reason: "Authorized test mutation",
            inboundPrompt: "Updated staging-safe prompt",
          },
        }),
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.inboundPrompt, "Updated staging-safe prompt");
    },
  );

  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].method, "PUT");
  assert.deepEqual(api.requests[0].body, {
    inboundPrompt: "Updated staging-safe prompt",
  });
  const audit = fs.readFileSync(auditFile, "utf8");
  assert.equal(audit.includes("Updated staging-safe prompt"), false);
  assert.equal(audit.includes("Authorized test mutation"), false);
  assert.equal(audit.includes('"operation":"mutation"'), true);
  assert.equal(audit.includes('"outcome":"success"'), true);
});
