#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config, {
    enableMutations: process.env.SP_API_ENABLE_MUTATIONS === "true",
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  if (
    message.startsWith("Amazon SP-API credential") ||
    message.startsWith("Unable to read Amazon SP-API credential") ||
    message.startsWith("Invalid Amazon SP-API credential")
  ) {
    console.error(message);
  } else {
    console.error("Amazon SP-API MCP failed to start");
  }
  process.exit(1);
});
