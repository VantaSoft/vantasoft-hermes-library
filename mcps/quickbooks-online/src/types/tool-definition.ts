import { z } from "zod";

export interface ToolDefinition<T extends z.ZodType<any, any>> {
  name: string;
  description: string;
  schema: T;
  // Keep the local registry boundary shallow. The MCP SDK's recursive
  // ToolCallback generic can exceed TypeScript's instantiation depth when the
  // complete QBO catalog is type-checked under the test configuration.
  handler: (...args: any[]) => any;
}
