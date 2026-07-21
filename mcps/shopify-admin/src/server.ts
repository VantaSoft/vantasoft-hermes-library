import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyConfig } from "./config.js";
import { ShopifyService } from "./shopify-service.js";
import { registerTools } from "./tools.js";

export function createServer(
  config: ShopifyConfig,
  options: { enableMutations?: boolean; service?: ShopifyService } = {},
): McpServer {
  const server = new McpServer({
    name: "shopify-admin",
    version: "1.0.0",
  });
  const service = options.service ?? new ShopifyService(config);
  registerTools(server, service, {
    enableMutations: options.enableMutations ?? false,
  });
  return server;
}
