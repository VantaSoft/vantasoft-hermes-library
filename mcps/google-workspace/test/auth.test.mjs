import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "google-workspace-mcp-test-"));
process.env.GOOGLE_MCP_CONFIG_DIR = path.join(temporaryRoot, "credentials");

const auth = await import("../dist/auth.js");

function resetStore() {
  fs.rmSync(process.env.GOOGLE_MCP_CONFIG_DIR, { recursive: true, force: true });
}

test.after(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("validates account slugs and rejects traversal", () => {
  assert.equal(auth.validateAccountName("work_account-2"), "work_account-2");
  for (const invalid of ["", "Work", "../work", "work/account", "work.", "_work"]) {
    assert.throws(() => auth.validateAccountName(invalid), /Invalid Google account name/);
  }
});

test("stores multiple accounts and preserves the first default", async () => {
  resetStore();
  await auth.saveTokensForAccount("personal", {
    access_token: "personal-access",
    refresh_token: "personal-refresh",
  });
  await auth.saveTokensForAccount("work", {
    access_token: "work-access",
    refresh_token: "work-refresh",
  });

  assert.deepEqual(await auth.listAccounts(), ["personal", "work"]);
  assert.equal(await auth.getDefaultAccount(), "personal");
  assert.equal(await auth.resolveAccountName(), "personal");
  assert.equal(await auth.resolveAccountName("work"), "work");
});

test("changes the default and selects the replacement after removal", async () => {
  resetStore();
  await auth.saveTokensForAccount("personal", { access_token: "personal" });
  await auth.saveTokensForAccount("work", { access_token: "work" });
  await auth.setDefaultAccount("work");
  assert.equal(await auth.getDefaultAccount(), "work");

  await auth.removeAccount("work");
  assert.equal(await auth.getDefaultAccount(), "personal");
  assert.deepEqual(await auth.listAccounts(), ["personal"]);
});

test("refresh writes merge credentials and preserve the refresh token", async () => {
  resetStore();
  await auth.saveTokensForAccount("work", {
    access_token: "old-access",
    refresh_token: "stable-refresh",
  });
  await auth.saveTokensForAccount("work", {
    access_token: "new-access",
    expiry_date: 123456789,
  });

  assert.deepEqual(auth.readTokensForAccount("work"), {
    access_token: "new-access",
    refresh_token: "stable-refresh",
    expiry_date: 123456789,
  });
});

test("writes profile-local token files with owner-only permissions", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX mode assertions do not apply on Windows");
    return;
  }
  resetStore();
  await auth.saveTokensForAccount("work", { access_token: "access" });

  const tokenMode = fs.statSync(auth.getTokensPath("work")).mode & 0o777;
  const configMode = fs.statSync(
    path.join(process.env.GOOGLE_MCP_CONFIG_DIR, "config.json"),
  ).mode & 0o777;
  assert.equal(tokenMode, 0o600);
  assert.equal(configMode, 0o600);
});

test("requires an explicit account when a damaged store loses its default", async () => {
  resetStore();
  await auth.saveTokensForAccount("personal", { access_token: "personal" });
  await auth.saveTokensForAccount("work", { access_token: "work" });
  fs.unlinkSync(path.join(process.env.GOOGLE_MCP_CONFIG_DIR, "config.json"));

  await assert.rejects(auth.resolveAccountName(), /no default is selected/);
  assert.equal(await auth.resolveAccountName("work"), "work");
});

test("builds an OAuth client from the profile-local client and account files", async () => {
  resetStore();
  fs.mkdirSync(process.env.GOOGLE_MCP_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    auth.getCredentialsPath(),
    JSON.stringify({
      installed: {
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uris: ["http://localhost:3000/oauth/callback"],
      },
    }),
    { mode: 0o600 },
  );
  await auth.saveTokensForAccount("work", {
    access_token: "access-token",
    refresh_token: "refresh-token",
  });

  const client = await auth.getAuthClient("work");
  assert.equal(client.credentials.access_token, "access-token");
  assert.equal(client.credentials.refresh_token, "refresh-token");
});
