import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpApiConfig } from "./config.js";
import { SpApiService } from "./sp-api-service.js";
import { registerTools } from "./tools.js";

export function createServer(
  config: SpApiConfig,
  options: { enableMutations?: boolean; service?: SpApiService } = {},
): McpServer {
  const server = new McpServer({
    name: "amazon-sp-api",
    version: "1.0.0",
  });
  const service = options.service ?? new SpApiService(config);
  registerTools(server, service, {
    enableMutations: options.enableMutations ?? false,
  });
  return server;
}
