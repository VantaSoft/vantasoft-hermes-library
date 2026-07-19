import { google } from "googleapis";
import type { Credentials, OAuth2Client } from "google-auth-library";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ACCOUNT_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const authClients = new Map<string, OAuth2Client>();

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
];

export function getHermesHome(): string {
  const configured = process.env.HERMES_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".hermes");
}

export function getConfigDir(): string {
  const override = process.env.GOOGLE_MCP_CONFIG_DIR?.trim();
  return override
    ? path.resolve(override)
    : path.join(getHermesHome(), "mcp-tokens", "google-workspace");
}

export function getCredentialsPath(): string {
  return path.join(getConfigDir(), "client.json");
}

function getAccountsDir(): string {
  return path.join(getConfigDir(), "accounts");
}

function getSettingsPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Windows and some network filesystems do not implement POSIX modes.
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(filePath));
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Windows and some network filesystems do not implement POSIX modes.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Google Workspace credentials at ${filePath}: ${message}`);
  }
}

export function validateAccountName(account: string): string {
  const normalized = account.trim();
  if (!ACCOUNT_RE.test(normalized)) {
    throw new Error(
      `Invalid Google account name '${account}'. Use 1-64 lowercase letters, numbers, underscores, or hyphens; begin and end with a letter or number.`,
    );
  }
  return normalized;
}

export function getTokensPath(account: string): string {
  const selected = validateAccountName(account);
  return path.join(getAccountsDir(), `${selected}.json`);
}

export async function listAccounts(): Promise<string[]> {
  try {
    return fs
      .readdirSync(getAccountsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .filter((name) => ACCOUNT_RE.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function readSettings(): { version: 1; defaultAccount?: string } {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) return { version: 1 };
  const raw = readJson(settingsPath);
  const defaultAccount =
    typeof raw.defaultAccount === "string" ? validateAccountName(raw.defaultAccount) : undefined;
  return { version: 1, defaultAccount };
}

function writeSettings(defaultAccount: string): void {
  atomicWriteJson(getSettingsPath(), {
    version: 1,
    defaultAccount: validateAccountName(defaultAccount),
  });
}

export async function getDefaultAccount(): Promise<string | undefined> {
  const accounts = await listAccounts();
  if (accounts.length === 0) return undefined;
  const configured = readSettings().defaultAccount;
  if (configured && accounts.includes(configured)) return configured;
  if (accounts.includes("default")) return "default";
  if (accounts.length === 1) return accounts[0];
  return undefined;
}

export async function resolveAccountName(account?: string): Promise<string> {
  if (account?.trim()) {
    const selected = validateAccountName(account);
    if (!fs.existsSync(getTokensPath(selected))) {
      const available = await listAccounts();
      throw new Error(
        `Google Workspace account '${selected}' is not configured. Available accounts: ${available.join(", ") || "none"}.`,
      );
    }
    return selected;
  }

  const selected = await getDefaultAccount();
  if (selected) return selected;
  const accounts = await listAccounts();
  if (accounts.length > 1) {
    throw new Error(
      `Multiple Google Workspace accounts are configured (${accounts.join(", ")}), but no default is selected. Run the setup command with 'set-default'.`,
    );
  }
  throw new Error("No Google Workspace accounts are configured. Run the setup command with 'auth'.");
}

export async function setDefaultAccount(account: string): Promise<void> {
  const selected = await resolveAccountName(account);
  writeSettings(selected);
}

export function readTokensForAccount(account: string): Credentials {
  const selected = validateAccountName(account);
  return readJson(getTokensPath(selected)) as Credentials;
}

export async function saveTokensForAccount(
  account: string,
  tokens: Credentials,
): Promise<void> {
  const selected = validateAccountName(account);
  const tokenPath = getTokensPath(selected);
  const defaultBeforeWrite = await getDefaultAccount();
  const existing = fs.existsSync(tokenPath) ? readTokensForAccount(selected) : {};
  atomicWriteJson(tokenPath, { ...existing, ...tokens });
  const configuredDefault = readSettings().defaultAccount;
  if (!defaultBeforeWrite) {
    writeSettings(selected);
  } else if (!configuredDefault) {
    writeSettings(defaultBeforeWrite);
  }
  authClients.delete(selected);
}

export async function removeAccount(account: string): Promise<void> {
  const selected = await resolveAccountName(account);
  try {
    fs.unlinkSync(getTokensPath(selected));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  authClients.delete(selected);

  const accounts = await listAccounts();
  if (accounts.length === 0) {
    try {
      fs.unlinkSync(getSettingsPath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }

  const currentDefault = readSettings().defaultAccount;
  if (currentDefault === selected || !currentDefault || !accounts.includes(currentDefault)) {
    writeSettings(accounts.includes("default") ? "default" : accounts[0]);
  }
}

export async function isConfigured(account?: string): Promise<boolean> {
  if (!fs.existsSync(getCredentialsPath())) return false;
  try {
    await resolveAccountName(account);
    return true;
  } catch {
    return false;
  }
}

function loadOAuthClientConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const credentialsPath = getCredentialsPath();
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Google OAuth client credentials are missing. Save the downloaded client JSON at ${credentialsPath}.`,
    );
  }
  const credentials = readJson(credentialsPath);
  const client = (credentials.installed ?? credentials.web) as
    | Record<string, unknown>
    | undefined;
  if (!client) throw new Error("Google OAuth client JSON must contain 'installed' or 'web'.");
  const clientId = typeof client.client_id === "string" ? client.client_id : "";
  const clientSecret = typeof client.client_secret === "string" ? client.client_secret : "";
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client JSON is missing client_id or client_secret.");
  }
  const redirectUris = Array.isArray(client.redirect_uris)
    ? client.redirect_uris.filter((item): item is string => typeof item === "string")
    : [];
  const redirectUri =
    redirectUris.find((item) => item.startsWith("http://localhost:3000/")) ??
    "http://localhost:3000/oauth/callback";
  return { clientId, clientSecret, redirectUri };
}

export function createOAuthClient(): OAuth2Client {
  const config = loadOAuthClientConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export async function getAuthClient(account?: string): Promise<OAuth2Client> {
  const selected = await resolveAccountName(account);
  const cached = authClients.get(selected);
  if (cached) return cached;

  const client = createOAuthClient();
  client.setCredentials(readTokensForAccount(selected));
  client.on("tokens", (tokens) => {
    void saveTokensForAccount(selected, tokens).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to persist refreshed Google Workspace credentials for account '${selected}': ${message}`,
      );
    });
  });
  authClients.set(selected, client);
  return client;
}
