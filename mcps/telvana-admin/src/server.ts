import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuditLogger } from "./audit.js";
import type { TelvanaConfig } from "./config.js";
import { TelvanaService } from "./service.js";
import { TelvanaClient, type FetchImplementation } from "./telvana-client.js";
import { registerTools } from "./tools.js";

export interface ServerOptions {
  audit?: AuditLogger;
  fetchImplementation?: FetchImplementation;
  service?: TelvanaService;
}

export function createServer(
  config: TelvanaConfig,
  options: ServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "telvana-admin",
    version: "1.0.0",
  });
  const audit = options.audit ?? new AuditLogger(config.auditFile);
  const service =
    options.service ??
    new TelvanaService(
      config,
      new TelvanaClient(config, options.fetchImplementation),
    );
  registerTools(server, config, service, audit);
  return server;
}
