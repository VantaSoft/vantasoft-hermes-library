import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const environmentNameSchema = z.enum([
  "development",
  "staging",
  "production",
]);
export type EnvironmentName = z.infer<typeof environmentNameSchema>;

const endpointSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  allowMutations: z.boolean().optional().default(false),
});

const credentialsSchema = z
  .object({
    environments: z.record(environmentNameSchema, endpointSchema),
  })
  .superRefine((credentials, context) => {
    if (Object.keys(credentials.environments).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environments"],
        message: "At least one environment must be configured",
      });
    }
  });

export type TelvanaEndpointConfig = z.infer<typeof endpointSchema>;
export interface TelvanaConfig extends TelvanaEndpointConfig {
  actor: string;
  auditFile: string;
  environment: EnvironmentName;
  mutationsEnabled: boolean;
}

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

export function resolveCredentialsFile(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.TELVANA_CREDENTIALS_FILE) {
    return expandHome(environment.TELVANA_CREDENTIALS_FILE);
  }
  if (environment.HERMES_HOME) {
    return path.join(
      environment.HERMES_HOME,
      "mcp-tokens",
      "telvana-admin",
      "credentials.json",
    );
  }
  return path.join(
    os.homedir(),
    ".config",
    "vantasoft-mcps",
    "telvana-admin",
    "credentials.json",
  );
}

export function resolveAuditFile(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.TELVANA_AUDIT_FILE) {
    return expandHome(environment.TELVANA_AUDIT_FILE);
  }
  if (environment.HERMES_HOME) {
    return path.join(
      environment.HERMES_HOME,
      "mcp-logs",
      "telvana-admin",
      "audit.jsonl",
    );
  }
  return path.join(
    os.homedir(),
    ".local",
    "state",
    "vantasoft-mcps",
    "telvana-admin",
    "audit.jsonl",
  );
}

function readCredentials(file: string): z.infer<typeof credentialsSchema> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new UserInputError(`Unable to read Telvana credential file: ${file}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserInputError(
      `Telvana credential file contains invalid JSON: ${file}`,
    );
  }

  const result = credentialsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new UserInputError(
      `Invalid Telvana credential configuration: ${issues}`,
    );
  }

  try {
    fs.chmodSync(path.dirname(file), 0o700);
    fs.chmodSync(file, 0o600);
  } catch {
    // Some filesystems do not expose POSIX permissions.
  }

  return result.data;
}

function validateBaseUrl(
  environmentName: EnvironmentName,
  rawBaseUrl: string,
): string {
  const url = new URL(rawBaseUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw new UserInputError(
      `Invalid ${environmentName} Telvana baseUrl: credentials, query strings, and fragments are not allowed`,
    );
  }

  if (environmentName !== "development" && url.protocol !== "https:") {
    throw new UserInputError(
      `${environmentName} Telvana baseUrl must use HTTPS`,
    );
  }

  if (url.protocol === "http:") {
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopbackHosts.has(url.hostname)) {
      throw new UserInputError(
        "Development Telvana HTTP baseUrl must use a loopback host",
      );
    }
  } else if (url.protocol !== "https:") {
    throw new UserInputError("Telvana baseUrl must use HTTP or HTTPS");
  }

  return rawBaseUrl.replace(/\/+$/, "");
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  file = resolveCredentialsFile(environment),
): TelvanaConfig {
  const environmentResult = environmentNameSchema.safeParse(
    environment.TELVANA_ENVIRONMENT,
  );
  if (!environmentResult.success) {
    throw new UserInputError(
      "TELVANA_ENVIRONMENT must explicitly select development, staging, or production",
    );
  }

  const actor = environment.TELVANA_MCP_ACTOR;
  if (!actor || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/.test(actor)) {
    throw new UserInputError(
      "TELVANA_MCP_ACTOR must identify the calling profile or operator",
    );
  }

  const environmentName = environmentResult.data;
  if (
    environmentName === "production" &&
    environment.TELVANA_ALLOW_PRODUCTION !== "true"
  ) {
    throw new UserInputError(
      "Production is disabled; an authorized operator must set TELVANA_ALLOW_PRODUCTION=true",
    );
  }

  const credentials = readCredentials(file);
  const endpoint = credentials.environments[environmentName];
  if (!endpoint) {
    throw new UserInputError(
      `No Telvana credentials are configured for ${environmentName}`,
    );
  }

  const mutationRequested = environment.TELVANA_ENABLE_MUTATIONS === "true";
  if (mutationRequested && !endpoint.allowMutations) {
    throw new UserInputError(
      `Mutations are not authorized in the ${environmentName} credential configuration`,
    );
  }

  return {
    ...endpoint,
    baseUrl: validateBaseUrl(environmentName, endpoint.baseUrl),
    actor,
    auditFile: resolveAuditFile(environment),
    environment: environmentName,
    mutationsEnabled: mutationRequested && endpoint.allowMutations,
  };
}
