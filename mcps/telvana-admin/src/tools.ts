import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { AuditLogger, AuditOperation } from "./audit.js";
import { TOOL_CATALOG, TOOL_CATALOG_VERSION } from "./catalog.js";
import type { TelvanaConfig } from "./config.js";
import { sanitizeError } from "./errors.js";
import type { TelvanaService } from "./service.js";

const resourceId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe("Telvana resource ID");
const reason = z
  .string()
  .min(3)
  .max(500)
  .describe(
    "Operator-visible reason for this approved mutation; not written to audit logs",
  );
const prompt = z.string().min(1).max(100_000);

const settingsSchema = z
  .object({
    hasCallTransfer: z.boolean().optional(),
    hasEndCall: z.boolean().optional(),
    transferCallerId: z.enum(["human", "agent"]).optional(),
    hasAutoInboundTransfer: z.boolean().optional(),
    inboundTransferNumber: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .nullable()
      .optional(),
    isMultilingual: z.boolean().optional(),
    hasBargeIn: z.boolean().optional(),
    hasHints: z.boolean().optional(),
    hints: z.string().max(10_000).nullable().optional(),
    hasLanguage: z.boolean().optional(),
    language: z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .nullable()
      .optional(),
    voiceId: z.string().min(1).max(256).nullable().optional(),
  })
  .strict()
  .refine((settings) => Object.keys(settings).length > 0, {
    message: "At least one approved agent setting is required",
  });

const outboundPromptUpdateSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    instructions: prompt.optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, {
    message: "Provide title or instructions",
  });

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface RegistrationOptions<T extends ZodRawShape> {
  annotations?: ToolAnnotations;
  operation?: AuditOperation;
  target: (args: z.infer<z.ZodObject<T>>) => Record<string, string>;
}

function mcpResult(value: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function auditFailure(
  config: TelvanaConfig,
  requestId: string,
  message: string,
) {
  return {
    ok: false,
    error: {
      code: "AUDIT_WRITE_FAILED",
      message,
      retryable: false,
    },
    meta: { environment: config.environment, requestId },
  };
}

function register<T extends ZodRawShape>(
  server: McpServer,
  config: TelvanaConfig,
  audit: AuditLogger,
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown>,
  options: RegistrationOptions<T>,
): void {
  const registerTool = server.registerTool.bind(server) as unknown as (
    toolName: string,
    toolConfig: {
      description: string;
      inputSchema: ZodRawShape;
      annotations: Record<string, boolean>;
    },
    callback: (args: Record<string, unknown>) => Promise<unknown>,
  ) => unknown;

  registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: {
        readOnlyHint: options.annotations?.readOnlyHint ?? true,
        destructiveHint: options.annotations?.destructiveHint ?? false,
        idempotentHint: options.annotations?.idempotentHint ?? true,
        openWorldHint: options.annotations?.openWorldHint ?? true,
      },
    },
    async (rawArgs) => {
      const args = rawArgs as z.infer<z.ZodObject<T>>;
      const requestId = randomUUID();
      const operation = options.operation ?? "read";
      const target = options.target(args);
      const auditBase = {
        actor: config.actor,
        environment: config.environment,
        operation,
        requestId,
        target,
        tool: name,
      };

      try {
        await audit.record({ ...auditBase, outcome: "started" });
      } catch {
        return mcpResult(
          auditFailure(
            config,
            requestId,
            "The operation was not attempted because its audit record could not be started",
          ),
          true,
        );
      }

      try {
        const data = await handler(args);
        try {
          await audit.record({ ...auditBase, outcome: "success" });
        } catch {
          return mcpResult(
            auditFailure(
              config,
              requestId,
              "The operation completed but its final audit record failed; verify target state before retrying",
            ),
            true,
          );
        }
        return mcpResult({
          ok: true,
          data,
          meta: { environment: config.environment, requestId },
        });
      } catch (error) {
        const safe = sanitizeError(error, config.environment, requestId);
        try {
          await audit.record({
            ...auditBase,
            outcome: "error",
            errorCode: safe.error.code,
          });
        } catch {
          return mcpResult(
            auditFailure(
              config,
              requestId,
              "The operation failed and its final audit record could not be written",
            ),
            true,
          );
        }
        return mcpResult(safe, true);
      }
    },
  );
}

export function registerTools(
  server: McpServer,
  config: TelvanaConfig,
  service: TelvanaService,
  audit: AuditLogger,
): void {
  const confirmEnvironment = z
    .literal(config.environment)
    .describe(
      `Must exactly confirm the selected ${config.environment} environment`,
    );

  register(
    server,
    config,
    audit,
    "telvana_get_server_info",
    "Return the selected Telvana environment and safe server capabilities without credentials",
    {},
    async () => service.getServerInfo(),
    { target: () => ({ resource: "server-info" }) },
  );

  register(
    server,
    config,
    audit,
    "telvana_get_tool_catalog",
    "Return the versioned Telvana administration tool catalog and whether each tool is enabled",
    {},
    async () => ({
      version: TOOL_CATALOG_VERSION,
      tools: TOOL_CATALOG.map((tool) => ({
        ...tool,
        enabled: tool.operation === "read" || config.mutationsEnabled,
      })),
    }),
    { target: () => ({ resource: "tool-catalog" }) },
  );

  register(
    server,
    config,
    audit,
    "telvana_get_agent",
    "Get one workspace-scoped Telvana agent configuration by ID",
    { agentId: resourceId },
    async ({ agentId }) => service.getAgent(agentId),
    { target: ({ agentId }) => ({ agentId }) },
  );

  register(
    server,
    config,
    audit,
    "telvana_list_outbound_prompts",
    "List outbound prompts for one workspace-scoped Telvana agent",
    { agentId: resourceId },
    async ({ agentId }) => service.listOutboundPrompts(agentId),
    { target: ({ agentId }) => ({ agentId }) },
  );

  register(
    server,
    config,
    audit,
    "telvana_get_outbound_prompt",
    "Get one outbound prompt belonging to a workspace-scoped Telvana agent",
    { agentId: resourceId, promptId: resourceId },
    async ({ agentId, promptId }) =>
      service.getOutboundPrompt(agentId, promptId),
    { target: ({ agentId, promptId }) => ({ agentId, promptId }) },
  );

  if (!config.mutationsEnabled) return;

  register(
    server,
    config,
    audit,
    "telvana_update_inbound_prompt",
    "MUTATION: Replace one agent's inbound prompt after explicitly confirming the selected environment",
    {
      agentId: resourceId,
      confirmEnvironment,
      reason,
      inboundPrompt: prompt,
    },
    async ({ agentId, inboundPrompt }) =>
      service.updateInboundPrompt(agentId, inboundPrompt),
    {
      operation: "mutation",
      annotations: { readOnlyHint: false },
      target: ({ agentId }) => ({ agentId }),
    },
  );

  register(
    server,
    config,
    audit,
    "telvana_update_agent_settings",
    "MUTATION: Update the approved subset of one agent's settings after explicitly confirming the selected environment",
    {
      agentId: resourceId,
      confirmEnvironment,
      reason,
      settings: settingsSchema,
    },
    async ({ agentId, settings }) =>
      service.updateAgentSettings(agentId, settings),
    {
      operation: "mutation",
      annotations: { readOnlyHint: false },
      target: ({ agentId }) => ({ agentId }),
    },
  );

  register(
    server,
    config,
    audit,
    "telvana_update_outbound_prompt",
    "MUTATION: Update one outbound prompt after explicitly confirming the selected environment",
    {
      agentId: resourceId,
      promptId: resourceId,
      confirmEnvironment,
      reason,
      update: outboundPromptUpdateSchema,
    },
    async ({ agentId, promptId, update }) =>
      service.updateOutboundPrompt(agentId, promptId, update),
    {
      operation: "mutation",
      annotations: { readOnlyHint: false },
      target: ({ agentId, promptId }) => ({ agentId, promptId }),
    },
  );
}
