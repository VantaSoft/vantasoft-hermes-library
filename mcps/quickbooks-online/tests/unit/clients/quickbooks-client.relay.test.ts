import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

const CONNECTION_ID = "12345678-1234-4123-8123-123456789abc";
const RELAY_TOKEN = "relay-token-with-at-least-thirty-two-characters";
const INITIAL_HANDOFF = "22345678-1234-4123-8123-123456789abc";
const REFRESH_HANDOFF = "32345678-1234-4123-8123-123456789abc";
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-relay-test-"));
const credentialFile = path.join(testDirectory, ".env");

fs.writeFileSync(
  credentialFile,
  [
    "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
    `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
    `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
    "QUICKBOOKS_ENVIRONMENT=production",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
process.env.QUICKBOOKS_ENV_FILE = credentialFile;
process.env.OAUTH_RELAY_URL = "https://oauth.vantasoft.com";
process.env.OAUTH_CONNECTION_ID = CONNECTION_ID;
process.env.OAUTH_RELAY_TOKEN = RELAY_TOKEN;
process.env.QUICKBOOKS_ENVIRONMENT = "production";
delete process.env.QUICKBOOKS_BROKER_URL;
delete process.env.QUICKBOOKS_CONNECTION_ID;
delete process.env.QUICKBOOKS_BROKER_TOKEN;
delete process.env.QUICKBOOKS_CLIENT_ID;
delete process.env.QUICKBOOKS_CLIENT_SECRET;
delete process.env.QUICKBOOKS_REFRESH_TOKEN;
delete process.env.QUICKBOOKS_REALM_ID;
delete process.env.QUICKBOOKS_ACCESS_TOKEN;
delete process.env.QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT;
delete process.env.OAUTH_PENDING_HANDOFF_ID;

const relayMock = {
  connectionStatus: jest.fn(async () => ({
    connectionId: CONNECTION_ID,
    provider: "intuit" as const,
    status: "authorized",
    handoffId: INITIAL_HANDOFF,
  })),
  retrieveHandoff: jest.fn(async (handoffId: string) => ({
    accessToken:
      handoffId === INITIAL_HANDOFF
        ? "initial-access-token-with-at-least-twenty-characters"
        : "refreshed-access-token-with-at-least-twenty-characters",
    refreshToken:
      handoffId === INITIAL_HANDOFF
        ? "initial-refresh-token-with-at-least-twenty-characters"
        : "rotated-refresh-token-with-at-least-twenty-characters",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    providerMetadata:
      handoffId === INITIAL_HANDOFF ? { realmId: "123456789" } : {},
  })),
  acknowledgeHandoff: jest.fn(async () => undefined),
  refresh: jest.fn(async () => REFRESH_HANDOFF),
  revoke: jest.fn(async () => undefined),
};

jest.unstable_mockModule("../../../src/clients/oauth-relay-client", () => ({
  OAuthRelayClient: class MockOAuthRelayClient {
    connectionStatus = relayMock.connectionStatus;
    retrieveHandoff = relayMock.retrieveHandoff;
    acknowledgeHandoff = relayMock.acknowledgeHandoff;
    refresh = relayMock.refresh;
    revoke = relayMock.revoke;
  },
}));

const oauthConstructor = jest.fn();
jest.unstable_mockModule("intuit-oauth", () => ({
  default: class MockOAuthClient {
    constructor(config: unknown) {
      oauthConstructor(config);
    }
  },
}));

type MockQuickBooksInstance = { args: unknown[] };
const quickBooksInstances: MockQuickBooksInstance[] = [];
jest.unstable_mockModule("node-quickbooks", () => ({
  default: class MockQuickBooks {
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
      quickBooksInstances.push(this);
    }
  },
}));

jest.unstable_mockModule("open", () => ({
  default: jest.fn(async () => undefined),
}));

const { QuickbooksClient } = await import(
  "../../../src/clients/quickbooks-client"
);

describe("QuickbooksClient OAuth relay mode", () => {
  beforeEach(() => {
    relayMock.connectionStatus.mockClear();
    relayMock.retrieveHandoff.mockClear();
    relayMock.acknowledgeHandoff.mockClear();
    relayMock.refresh.mockClear();
    oauthConstructor.mockClear();
    quickBooksInstances.length = 0;
  });

  afterAll(() => {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  it("rejects simultaneous broker and relay configuration", () => {
    expect(
      () =>
        new QuickbooksClient({
          environment: "production",
          brokerUrl: "https://quickbooks.vantasoft.com",
          brokerConnectionId: CONNECTION_ID,
          brokerToken: RELAY_TOKEN,
          relayUrl: "https://oauth.vantasoft.com",
          relayConnectionId: CONNECTION_ID,
          relayToken: RELAY_TOKEN,
        }),
    ).toThrow("mutually exclusive");
  });

  it("persists an initial handoff before acknowledging and calls QBO directly", async () => {
    fs.writeFileSync(
      credentialFile,
      [
        "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
        `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
        `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
        "QUICKBOOKS_ENVIRONMENT=production",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const client = new QuickbooksClient({
      environment: "production",
      relayUrl: "https://oauth.vantasoft.com",
      relayConnectionId: CONNECTION_ID,
      relayToken: RELAY_TOKEN,
    });

    const instance = (await client.authenticate()) as unknown as MockQuickBooksInstance;
    expect(relayMock.connectionStatus).toHaveBeenCalledTimes(1);
    expect(relayMock.retrieveHandoff).toHaveBeenCalledWith(INITIAL_HANDOFF);
    expect(relayMock.acknowledgeHandoff).toHaveBeenCalledWith(INITIAL_HANDOFF);
    expect(oauthConstructor).not.toHaveBeenCalled();
    expect(instance.args[0]).toBe("relay");
    expect(instance.args[2]).toBe(
      "initial-access-token-with-at-least-twenty-characters",
    );
    expect(instance.args[4]).toBe("123456789");
    expect(instance.args[5]).toBe(false);

    const persisted = fs.readFileSync(credentialFile, "utf8");
    expect(persisted).toContain(
      "QUICKBOOKS_REFRESH_TOKEN=initial-refresh-token-with-at-least-twenty-characters",
    );
    expect(persisted).toContain(
      "QUICKBOOKS_ACCESS_TOKEN=initial-access-token-with-at-least-twenty-characters",
    );
    expect(persisted).not.toContain("OAUTH_PENDING_HANDOFF_ID=");
    expect(fs.statSync(credentialFile).mode & 0o777).toBe(0o600);
  });

  it("refreshes an expired local token through the relay and persists rotation", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    fs.writeFileSync(
      credentialFile,
      [
        "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
        `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
        `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
        "QUICKBOOKS_ENVIRONMENT=production",
        "QUICKBOOKS_REFRESH_TOKEN=old-refresh-token-with-at-least-twenty-characters",
        "QUICKBOOKS_ACCESS_TOKEN=expired-access-token-with-at-least-twenty-characters",
        `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT=${expiredAt}`,
        "QUICKBOOKS_REALM_ID=123456789",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const client = new QuickbooksClient({
      environment: "production",
      relayUrl: "https://oauth.vantasoft.com",
      relayConnectionId: CONNECTION_ID,
      relayToken: RELAY_TOKEN,
      refreshToken: "old-refresh-token-with-at-least-twenty-characters",
      accessToken: "expired-access-token-with-at-least-twenty-characters",
      accessTokenExpiresAt: expiredAt.toString(),
      realmId: "123456789",
    });

    await client.authenticate();
    expect(relayMock.refresh).toHaveBeenCalledTimes(1);
    expect(relayMock.refresh).toHaveBeenCalledWith(
      "old-refresh-token-with-at-least-twenty-characters",
      expect.stringMatching(/^qbo_[a-f0-9]{64}$/),
    );
    expect(relayMock.acknowledgeHandoff).toHaveBeenCalledWith(REFRESH_HANDOFF);
    expect(fs.readFileSync(credentialFile, "utf8")).toContain(
      "QUICKBOOKS_REFRESH_TOKEN=rotated-refresh-token-with-at-least-twenty-characters",
    );
  });

  it("keeps a pending handoff marker when acknowledgement fails", async () => {
    fs.writeFileSync(
      credentialFile,
      [
        "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
        `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
        `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
        "QUICKBOOKS_ENVIRONMENT=production",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    relayMock.acknowledgeHandoff.mockRejectedValueOnce(
      new Error("relay unavailable"),
    );
    const client = new QuickbooksClient({
      environment: "production",
      relayUrl: "https://oauth.vantasoft.com",
      relayConnectionId: CONNECTION_ID,
      relayToken: RELAY_TOKEN,
    });

    await expect(client.authenticate()).rejects.toThrow("relay unavailable");
    const persisted = fs.readFileSync(credentialFile, "utf8");
    expect(persisted).toContain(`OAUTH_PENDING_HANDOFF_ID=${INITIAL_HANDOFF}`);
    expect(persisted).toContain(
      "QUICKBOOKS_REFRESH_TOKEN=initial-refresh-token-with-at-least-twenty-characters",
    );
  });

  it("serializes refreshes across client processes using the credential lock", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    fs.writeFileSync(
      credentialFile,
      [
        "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
        `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
        `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
        "QUICKBOOKS_ENVIRONMENT=production",
        "QUICKBOOKS_REFRESH_TOKEN=old-refresh-token-with-at-least-twenty-characters",
        "QUICKBOOKS_ACCESS_TOKEN=expired-access-token-with-at-least-twenty-characters",
        `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT=${expiredAt}`,
        "QUICKBOOKS_REALM_ID=123456789",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    let releaseRefresh!: () => void;
    relayMock.refresh.mockImplementationOnce(
      async () =>
        new Promise<string>((resolve) => {
          releaseRefresh = () => resolve(REFRESH_HANDOFF);
        }),
    );
    const createClient = () =>
      new QuickbooksClient({
        environment: "production",
        relayUrl: "https://oauth.vantasoft.com",
        relayConnectionId: CONNECTION_ID,
        relayToken: RELAY_TOKEN,
        refreshToken: "old-refresh-token-with-at-least-twenty-characters",
        accessToken: "expired-access-token-with-at-least-twenty-characters",
        accessTokenExpiresAt: expiredAt.toString(),
        realmId: "123456789",
      });
    const first = createClient().authenticate();
    while (relayMock.refresh.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const second = createClient().authenticate();
    releaseRefresh();
    await Promise.all([first, second]);
    expect(relayMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("retries a persisted handoff acknowledgement before using local tokens", async () => {
    const futureAt = Math.floor(Date.now() / 1000) + 3600;
    fs.writeFileSync(
      credentialFile,
      [
        "OAUTH_RELAY_URL=https://oauth.vantasoft.com",
        `OAUTH_CONNECTION_ID=${CONNECTION_ID}`,
        `OAUTH_RELAY_TOKEN=${RELAY_TOKEN}`,
        `OAUTH_PENDING_HANDOFF_ID=${INITIAL_HANDOFF}`,
        "QUICKBOOKS_REFRESH_TOKEN=initial-refresh-token-with-at-least-twenty-characters",
        "QUICKBOOKS_ACCESS_TOKEN=initial-access-token-with-at-least-twenty-characters",
        `QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT=${futureAt}`,
        "QUICKBOOKS_REALM_ID=123456789",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const client = new QuickbooksClient({
      environment: "production",
      relayUrl: "https://oauth.vantasoft.com",
      relayConnectionId: CONNECTION_ID,
      relayToken: RELAY_TOKEN,
      pendingRelayHandoffId: INITIAL_HANDOFF,
      refreshToken: "initial-refresh-token-with-at-least-twenty-characters",
      accessToken: "initial-access-token-with-at-least-twenty-characters",
      accessTokenExpiresAt: futureAt.toString(),
      realmId: "123456789",
    });

    await client.authenticate();
    expect(relayMock.acknowledgeHandoff).toHaveBeenCalledWith(INITIAL_HANDOFF);
    expect(relayMock.refresh).not.toHaveBeenCalled();
    expect(fs.readFileSync(credentialFile, "utf8")).not.toContain(
      "OAUTH_PENDING_HANDOFF_ID=",
    );
  });
});
