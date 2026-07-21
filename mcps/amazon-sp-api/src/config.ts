import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const storeSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  sellerId: z.string().min(1),
  region: z.enum(["NA", "EU", "FE"]),
  marketplaceId: z.string().min(1),
  sandbox: z.boolean().optional().default(false),
});

const configSchema = z
  .object({
    defaultStore: z.string().min(1).optional(),
    stores: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), storeSchema),
  })
  .superRefine((value, context) => {
    const names = Object.keys(value.stores);
    if (names.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stores"],
        message: "At least one store must be configured",
      });
    }
    if (value.defaultStore && !value.stores[value.defaultStore]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultStore"],
        message: "defaultStore must name a configured store",
      });
    }
  });

export type StoreConfig = z.infer<typeof storeSchema>;
export type SpApiConfig = z.infer<typeof configSchema>;

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveCredentialsFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.SP_API_CREDENTIALS_FILE?.trim();
  if (override) return path.resolve(expandHome(override));

  const hermesHome = env.HERMES_HOME?.trim();
  if (hermesHome) {
    return path.join(
      path.resolve(expandHome(hermesHome)),
      "mcp-tokens",
      "amazon-sp-api",
      "credentials.json",
    );
  }

  return path.join(
    os.homedir(),
    ".config",
    "vantasoft-mcps",
    "amazon-sp-api",
    "credentials.json",
  );
}

export function loadConfig(
  credentialFile = resolveCredentialsFile(),
): SpApiConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(credentialFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Amazon SP-API credential file not found: ${credentialFile}`,
      );
    }
    throw new Error(
      `Unable to read Amazon SP-API credential file: ${credentialFile}`,
    );
  }

  try {
    fs.chmodSync(path.dirname(credentialFile), 0o700);
    fs.chmodSync(credentialFile, 0o600);
  } catch {
    // Some filesystems do not expose POSIX permissions.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Amazon SP-API credential file contains invalid JSON");
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid Amazon SP-API credential configuration: ${issues}`,
    );
  }

  const names = Object.keys(result.data.stores);
  return {
    ...result.data,
    defaultStore: result.data.defaultStore ?? names[0],
  };
}

export function getStore(
  config: SpApiConfig,
  requestedStore?: string,
): { name: string; config: StoreConfig } {
  const name = requestedStore ?? config.defaultStore;
  if (!name || !config.stores[name]) {
    throw new UserInputError(
      `Unknown Amazon SP-API store: ${requestedStore ?? "(default)"}`,
    );
  }
  return { name, config: config.stores[name] };
}

export function listSafeStores(config: SpApiConfig): object[] {
  return Object.entries(config.stores).map(([name, store]) => ({
    name,
    default: name === config.defaultStore,
    region: store.region,
    marketplaceId: store.marketplaceId,
    sandbox: store.sandbox,
    sellerIdConfigured: Boolean(store.sellerId),
  }));
}

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}
