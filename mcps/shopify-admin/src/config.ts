import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const apiVersionSchema = z
  .string()
  .regex(/^\d{4}-(01|04|07|10)$/)
  .default("2026-07");

const storeSchema = z
  .object({
    shopDomain: z
      .string()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
    accessToken: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    apiVersion: apiVersionSchema,
  })
  .superRefine((store, context) => {
    const staticToken = Boolean(store.accessToken);
    const clientCredentials = Boolean(store.clientId && store.clientSecret);
    if (staticToken === clientCredentials) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either accessToken or clientId plus clientSecret, but not both",
      });
    }
    if (Boolean(store.clientId) !== Boolean(store.clientSecret)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clientId and clientSecret must be provided together",
      });
    }
  });

const configSchema = z
  .object({
    defaultStore: z.string().min(1).optional(),
    stores: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), storeSchema),
  })
  .superRefine((config, context) => {
    const names = Object.keys(config.stores);
    if (names.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stores"],
        message: "At least one Shopify store is required",
      });
    }
    if (config.defaultStore && !config.stores[config.defaultStore]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultStore"],
        message: "defaultStore must name a configured store",
      });
    }
  });

export type StoreConfig = z.infer<typeof storeSchema>;
export type ShopifyConfig = z.infer<typeof configSchema> & {
  defaultStore: string;
};

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
  if (environment.SHOPIFY_CREDENTIALS_FILE) {
    return expandHome(environment.SHOPIFY_CREDENTIALS_FILE);
  }
  if (environment.HERMES_HOME) {
    return path.join(
      environment.HERMES_HOME,
      "mcp-tokens",
      "shopify-admin",
      "credentials.json",
    );
  }
  return path.join(
    os.homedir(),
    ".config",
    "vantasoft-mcps",
    "shopify-admin",
    "credentials.json",
  );
}

export function loadConfig(file = resolveCredentialsFile()): ShopifyConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new UserInputError(`Unable to read Shopify credential file: ${file}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserInputError(
      `Shopify credential file contains invalid JSON: ${file}`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new UserInputError(
      `Invalid Shopify credential configuration: ${issues}`,
    );
  }

  try {
    fs.chmodSync(path.dirname(file), 0o700);
    fs.chmodSync(file, 0o600);
  } catch {
    // Some filesystems do not expose POSIX permissions.
  }

  const names = Object.keys(result.data.stores);
  return {
    ...result.data,
    defaultStore: result.data.defaultStore ?? names[0],
  };
}

export function getStore(
  config: ShopifyConfig,
  requested?: string,
): { name: string; config: StoreConfig } {
  const name = requested ?? config.defaultStore;
  const store = config.stores[name];
  if (!store) throw new UserInputError(`Unknown Shopify store: ${name}`);
  return { name, config: store };
}

export function listSafeStores(config: ShopifyConfig): object[] {
  return Object.entries(config.stores).map(([name, store]) => ({
    name,
    default: name === config.defaultStore,
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    authentication: store.accessToken ? "static-token" : "client-credentials",
  }));
}
