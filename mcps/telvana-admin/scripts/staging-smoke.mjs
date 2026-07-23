import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

function requireValue(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parse(result) {
  const value = JSON.parse(result.content[0].text);
  if (!value.ok)
    throw new Error(
      `${value.error?.code ?? "UNKNOWN"}: ${value.error?.message ?? "Tool failed"}`,
    );
  return value;
}

async function main() {
  if (process.env.TELVANA_ENVIRONMENT !== "staging") {
    throw new Error(
      "Staging smoke test refuses to run unless TELVANA_ENVIRONMENT=staging",
    );
  }
  if (process.env.TELVANA_ENABLE_MUTATIONS !== "true") {
    throw new Error(
      "Staging smoke test requires TELVANA_ENABLE_MUTATIONS=true",
    );
  }
  if (process.env.TELVANA_ALLOW_PRODUCTION === "true") {
    throw new Error("Staging smoke test refuses production enablement");
  }

  const agentId = requireValue("TELVANA_SMOKE_AGENT_ID");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry) => typeof entry[1] === "string",
      ),
    ),
    stderr: "inherit",
  });
  const client = new Client({
    name: "telvana-admin-staging-smoke",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
    for (const required of [
      "telvana_get_agent",
      "telvana_update_inbound_prompt",
    ]) {
      if (!toolNames.includes(required)) {
        throw new Error(`Required staging tool is unavailable: ${required}`);
      }
    }

    const read = parse(
      await client.callTool({
        name: "telvana_get_agent",
        arguments: { agentId },
      }),
    );
    if (
      typeof read.data?.inboundPrompt !== "string" ||
      !read.data.inboundPrompt
    ) {
      throw new Error(
        "Approved staging agent does not have an inbound prompt to verify",
      );
    }

    const update = parse(
      await client.callTool({
        name: "telvana_update_inbound_prompt",
        arguments: {
          agentId,
          confirmEnvironment: "staging",
          reason: "Authorized idempotent staging MCP smoke test",
          inboundPrompt: read.data.inboundPrompt,
        },
      }),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          environment: "staging",
          discoveredTools: toolNames.length,
          readAgent: agentId,
          idempotentUpdateRequestId: update.meta.requestId,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Staging smoke test failed",
  );
  process.exit(1);
});
