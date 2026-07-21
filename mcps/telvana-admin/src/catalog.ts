export const TOOL_CATALOG_VERSION = "2026-07-21.v1";

export interface ToolCatalogEntry {
  name: string;
  operation: "read" | "mutation";
  resource: "server" | "agent" | "outbound-prompt";
  destructive: false;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "telvana_get_server_info",
    operation: "read",
    resource: "server",
    destructive: false,
  },
  {
    name: "telvana_get_tool_catalog",
    operation: "read",
    resource: "server",
    destructive: false,
  },
  {
    name: "telvana_get_agent",
    operation: "read",
    resource: "agent",
    destructive: false,
  },
  {
    name: "telvana_list_outbound_prompts",
    operation: "read",
    resource: "outbound-prompt",
    destructive: false,
  },
  {
    name: "telvana_get_outbound_prompt",
    operation: "read",
    resource: "outbound-prompt",
    destructive: false,
  },
  {
    name: "telvana_update_inbound_prompt",
    operation: "mutation",
    resource: "agent",
    destructive: false,
  },
  {
    name: "telvana_update_agent_settings",
    operation: "mutation",
    resource: "agent",
    destructive: false,
  },
  {
    name: "telvana_update_outbound_prompt",
    operation: "mutation",
    resource: "outbound-prompt",
    destructive: false,
  },
];
