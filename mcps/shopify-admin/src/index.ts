#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config, {
    enableMutations: process.env.SHOPIFY_ENABLE_MUTATIONS === "true",
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  if (
    message.startsWith("Unable to read Shopify credential") ||
    message.startsWith("Shopify credential file contains invalid JSON") ||
    message.startsWith("Invalid Shopify credential configuration")
  ) {
    console.error(message);
  } else {
    console.error("Shopify Admin MCP failed to start");
  }
  process.exit(1);
});
