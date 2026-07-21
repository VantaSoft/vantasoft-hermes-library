import fs from "fs";
import os from "os";
import path from "path";

const TOKEN_DIRECTORY = path.join("mcp-tokens", "quickbooks-online");

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Resolve the secret-bearing QuickBooks environment file.
 *
 * Hermes profiles default to HERMES_HOME/mcp-tokens/quickbooks-online/.env so
 * OAuth state stays profile-local. QUICKBOOKS_ENV_FILE is an explicit override.
 * The install-local .env fallback preserves compatibility outside Hermes.
 */
export function resolveCredentialFile(installRoot: string): string {
  const explicit = process.env.QUICKBOOKS_ENV_FILE?.trim();
  if (explicit) return path.resolve(expandHome(explicit));

  const hermesHome = process.env.HERMES_HOME?.trim();
  if (hermesHome) {
    return path.join(
      path.resolve(expandHome(hermesHome)),
      TOKEN_DIRECTORY,
      ".env",
    );
  }

  return path.join(installRoot, ".env");
}

/** Create the profile-local token directory before the first OAuth write. */
export function ensureCredentialDirectory(credentialFile: string): void {
  const directory = path.dirname(credentialFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems that do not implement POSIX permissions.
  }
}
