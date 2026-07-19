#!/usr/bin/env node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import { URL } from "node:url";
import { CodeChallengeMethod } from "google-auth-library";
import {
  SCOPES,
  createOAuthClient,
  getAuthClient,
  getConfigDir,
  getCredentialsPath,
  getDefaultAccount,
  listAccounts,
  removeAccount,
  resolveAccountName,
  saveTokensForAccount,
  setDefaultAccount,
  validateAccountName,
} from "./auth.js";

function usage(): never {
  console.error(`Google Workspace MCP account setup

Usage:
  google-workspace-setup auth [account]
  google-workspace-setup list
  google-workspace-setup set-default <account>
  google-workspace-setup revoke [account]
  google-workspace-setup remove [account]
  google-workspace-setup status

Account names are lowercase slugs such as default, personal, or work.`);
  process.exit(2);
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function authorize(accountArg?: string): Promise<void> {
  const account = validateAccountName(accountArg || "default");
  const credentialsPath = getCredentialsPath();
  if (!fs.existsSync(credentialsPath)) {
    console.error(`\nPlace your Google OAuth desktop client JSON at:\n  ${credentialsPath}\n`);
    console.error("Create it in Google Cloud Console after enabling Gmail, Calendar, and Drive APIs.");
    console.error(`The profile-local credential directory is:\n  ${getConfigDir()}\n`);
    process.exit(1);
  }

  const oauth2Client = createOAuthClient();
  const state = base64Url(crypto.randomBytes(24));
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.log(`\nAuthorizing Google Workspace account: ${account}`);
  console.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
  console.log("Waiting for the callback on http://127.0.0.1:3000/oauth/callback ...\n");

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out after five minutes."));
    }, 5 * 60 * 1000);

    const finish = (error?: Error) => {
      clearTimeout(timeout);
      server.close(() => (error ? reject(error) : resolve()));
    };

    const server = http.createServer(async (request, response) => {
      try {
        const callback = new URL(request.url || "/", "http://127.0.0.1:3000");
        if (callback.pathname !== "/oauth/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          response.writeHead(400).end("OAuth state mismatch");
          finish(new Error("OAuth state mismatch."));
          return;
        }
        const providerError = callback.searchParams.get("error");
        if (providerError) {
          response.writeHead(400).end("Google authorization was not completed.");
          finish(new Error(`Google returned OAuth error: ${providerError}`));
          return;
        }
        const code = callback.searchParams.get("code");
        if (!code) {
          response.writeHead(400).end("Missing authorization code");
          finish(new Error("Google OAuth callback did not include an authorization code."));
          return;
        }

        const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
        await saveTokensForAccount(account, tokens);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<h1>Google Workspace account '${account}' authorized.</h1><p>You can close this tab.</p>`);
        console.log(`\nAuthorized account '${account}'.`);
        console.log(`Default account: ${(await getDefaultAccount()) || account}`);
        finish();
      } catch (error) {
        response.writeHead(500).end("Google authorization failed.");
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.on("error", (error) => finish(error));
    server.listen(3000, "127.0.0.1");
  });
}

async function printAccounts(): Promise<void> {
  const accounts = await listAccounts();
  const defaultAccount = await getDefaultAccount();
  if (accounts.length === 0) {
    console.log("No Google Workspace accounts configured.");
    return;
  }
  for (const account of accounts) {
    console.log(`${account}${account === defaultAccount ? " (default)" : ""}`);
  }
}

async function revoke(accountArg?: string): Promise<void> {
  const account = await resolveAccountName(accountArg);
  const client = await getAuthClient(account);
  await client.revokeCredentials();
  await removeAccount(account);
  console.log(`Revoked and removed Google Workspace account '${account}'.`);
}

async function removeLocal(accountArg?: string): Promise<void> {
  const account = await resolveAccountName(accountArg);
  await removeAccount(account);
  console.log(`Removed local Google Workspace credentials for '${account}'.`);
}

async function status(): Promise<void> {
  console.log(`Credential directory: ${getConfigDir()}`);
  console.log(`OAuth client: ${fs.existsSync(getCredentialsPath()) ? "configured" : "missing"}`);
  await printAccounts();
}

async function main(): Promise<void> {
  const [command = "status", account] = process.argv.slice(2);
  if (command === "auth") return authorize(account);
  if (command === "list") return printAccounts();
  if (command === "set-default") {
    if (!account) usage();
    await setDefaultAccount(account);
    console.log(`Default Google Workspace account set to '${account}'.`);
    return;
  }
  if (command === "revoke") return revoke(account);
  if (command === "remove") return removeLocal(account);
  if (command === "status") return status();

  // Backward-compatible shorthand: `google-workspace-setup work`.
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(command)) return authorize(command);
  usage();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Google Workspace setup failed: ${message.replace(/Bearer\s+\S+/gi, "Bearer <redacted>")}`);
  process.exit(1);
});
