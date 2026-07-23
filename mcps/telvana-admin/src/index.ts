#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuditLogger } from "./audit.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const audit = new AuditLogger(config.auditFile);
  await audit.initialize();
  const server = createServer(config, { audit });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  if (
    message.startsWith("Unable to read Telvana credential") ||
    message.startsWith("Telvana credential file contains invalid JSON") ||
    message.startsWith("Invalid Telvana credential configuration") ||
    message.startsWith("TELVANA_") ||
    message.startsWith("No Telvana credentials") ||
    message.startsWith("Production is disabled") ||
    message.startsWith("Mutations are not authorized") ||
    message.includes("Telvana baseUrl")
  ) {
    console.error(message);
  } else {
    console.error("Telvana Admin MCP failed to start");
  }
  process.exit(1);
});
