import { jest } from "@jest/globals";

process.env.HERMES_HOME = "/profiles/broker-test";
process.env.QUICKBOOKS_BROKER_URL = "https://quickbooks.vantasoft.com";
process.env.QUICKBOOKS_CONNECTION_ID =
  "12345678-1234-4123-8123-123456789abc";
process.env.QUICKBOOKS_BROKER_TOKEN =
  "broker-token-with-at-least-thirty-two-characters";
delete process.env.QUICKBOOKS_CLIENT_ID;
delete process.env.QUICKBOOKS_CLIENT_SECRET;
delete process.env.QUICKBOOKS_REFRESH_TOKEN;
delete process.env.QUICKBOOKS_REALM_ID;

const oauthConstructor = jest.fn();
jest.unstable_mockModule("intuit-oauth", () => ({
  default: class MockOAuthClient {
    constructor(config: unknown) {
      oauthConstructor(config);
    }
  },
}));

type MockQuickBooksInstance = {
  endpoint: string;
  args: unknown[];
};
const quickBooksInstances: MockQuickBooksInstance[] = [];
jest.unstable_mockModule("node-quickbooks", () => ({
  default: class MockQuickBooks {
    endpoint = "https://quickbooks.api.intuit.com/v3/company/";
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

describe("QuickbooksClient broker mode", () => {
  it("uses only the customer-scoped broker credential and exposes no raw OAuth credentials", async () => {
    const first = (await QuickbooksClient.getInstance()) as unknown as MockQuickBooksInstance;
    const second = (await QuickbooksClient.getInstance()) as unknown as MockQuickBooksInstance;

    expect(first).toBe(second);
    expect(oauthConstructor).not.toHaveBeenCalled();
    expect(quickBooksInstances).toHaveLength(1);
    expect(first.endpoint).toBe(
      "https://quickbooks.vantasoft.com/v1/qbo/",
    );
    expect(first.args[0]).toBe("broker");
    expect(first.args[1]).toBe("broker");
    expect(first.args[2]).toBe(process.env.QUICKBOOKS_BROKER_TOKEN);
    expect(first.args[4]).toBe(process.env.QUICKBOOKS_CONNECTION_ID);
    expect(first.args[8]).toBe("2.0");
    expect(first.args[9]).toBeUndefined();

    await expect(QuickbooksClient.getAuthCredentials()).rejects.toThrow(
      "unavailable in broker mode",
    );
  });
});
