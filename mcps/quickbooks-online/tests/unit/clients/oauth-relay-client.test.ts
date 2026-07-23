import { jest } from "@jest/globals";
import { OAuthRelayClient } from "../../../src/clients/oauth-relay-client";

const CONNECTION_ID = "12345678-1234-4123-8123-123456789abc";
const RELAY_TOKEN = "relay-token-with-at-least-thirty-two-characters";
const HANDOFF_ID = "22345678-1234-4123-8123-123456789abc";

describe("OAuthRelayClient", () => {
  it("retrieves and acknowledges a token handoff without exposing relay credentials", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = jest.fn(async (input, init) => {
      calls.push({ url: String(input), init: init as RequestInit | undefined });
      if (String(input).endsWith(`/handoffs/${HANDOFF_ID}`)) {
        return new Response(
          JSON.stringify({
            accessToken: "access-token-with-at-least-twenty-characters",
            refreshToken: "refresh-token-with-at-least-twenty-characters",
            accessTokenExpiresAt: 1_800_000_000,
            providerMetadata: { realmId: "123456789" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ status: "acknowledged" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );

    const bundle = await client.retrieveHandoff(HANDOFF_ID);
    expect(bundle.providerMetadata.realmId).toBe("123456789");
    await client.acknowledgeHandoff(HANDOFF_ID);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({ authorization: `Bearer ${RELAY_TOKEN}` }),
    );
    expect(calls[1]?.init?.method).toBe("POST");
  });

  it("creates an idempotent refresh handoff", async () => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify({ handoffId: HANDOFF_ID }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(
      client.refresh(
        "refresh-token-with-at-least-twenty-characters",
        "refresh-attempt-00000001",
      ),
    ).resolves.toBe(HANDOFF_ID);
  });

  it("revokes through the fixed connection endpoint", async () => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify({ status: "revoked" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await client.revoke("refresh-token-with-at-least-twenty-characters");
    expect(fetcher).toHaveBeenCalledWith(
      `https://oauth.vantasoft.com/v1/oauth/connections/${CONNECTION_ID}/revoke`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    "http://oauth.vantasoft.com",
    "https://user:password@oauth.vantasoft.com",
    "https://oauth.vantasoft.com/path",
    "https://oauth.vantasoft.com?query=value",
    "https://oauth.vantasoft.com#fragment",
  ])("rejects an invalid relay origin: %s", (origin) => {
    expect(
      () => new OAuthRelayClient(origin, CONNECTION_ID, RELAY_TOKEN),
    ).toThrow("OAUTH_RELAY_URL must be an HTTPS origin");
  });

  it("rejects invalid connection and relay credentials", () => {
    expect(
      () =>
        new OAuthRelayClient(
          "https://oauth.vantasoft.com",
          "not-a-uuid",
          RELAY_TOKEN,
        ),
    ).toThrow("OAUTH_CONNECTION_ID must be a UUID");
    expect(
      () =>
        new OAuthRelayClient(
          "https://oauth.vantasoft.com",
          CONNECTION_ID,
          "short",
        ),
    ).toThrow("OAUTH_RELAY_TOKEN is invalid");
  });

  it.each([null, HANDOFF_ID])(
    "accepts a valid connection status with handoff %s",
    async (handoffId) => {
      const fetcher: typeof fetch = jest.fn(async () =>
        new Response(
          JSON.stringify({
            connectionId: CONNECTION_ID,
            provider: "intuit",
            status: "active",
            handoffId,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as typeof fetch;
      const client = new OAuthRelayClient(
        "https://oauth.vantasoft.com",
        CONNECTION_ID,
        RELAY_TOKEN,
        fetcher,
      );
      await expect(client.connectionStatus()).resolves.toEqual({
        connectionId: CONNECTION_ID,
        provider: "intuit",
        status: "active",
        handoffId,
      });
    },
  );

  it.each([
    {},
    { connectionId: "different", provider: "intuit", status: "active", handoffId: null },
    { connectionId: CONNECTION_ID, provider: "google", status: "active", handoffId: null },
    { connectionId: CONNECTION_ID, provider: "intuit", status: 1, handoffId: null },
    { connectionId: CONNECTION_ID, provider: "intuit", status: "active", handoffId: 1 },
  ])("rejects invalid connection status %#", async (payload) => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.connectionStatus()).rejects.toThrow(
      "OAuth relay returned an invalid connection status",
    );
  });

  it.each([
    {},
    { accessToken: "short", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: 1, providerMetadata: {} },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "short", accessTokenExpiresAt: 1, providerMetadata: {} },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: "invalid", providerMetadata: {} },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: 1.5, providerMetadata: {} },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: 1 },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: 1, providerMetadata: "invalid" },
    { accessToken: "access-token-with-at-least-twenty-characters", refreshToken: "refresh-token-with-at-least-twenty-characters", accessTokenExpiresAt: 1, providerMetadata: [] },
  ])("rejects invalid token bundle %#", async (payload) => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.retrieveHandoff(HANDOFF_ID)).rejects.toThrow(
      "OAuth relay returned an invalid token handoff",
    );
  });

  it("polls an in-progress handoff without starting another refresh", async () => {
    jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void) => {
        callback();
        return 0;
      }) as typeof setTimeout);
    let calls = 0;
    const fetcher: typeof fetch = jest.fn(async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          calls === 1
            ? { error: "handoff_processing" }
            : {
                accessToken: "access-token-with-at-least-twenty-characters",
                refreshToken: "refresh-token-with-at-least-twenty-characters",
                accessTokenExpiresAt: 1_800_000_000,
                providerMetadata: { realmId: "123456789" },
              },
        ),
        { status: calls === 1 ? 202 : 200 },
      );
    }) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.retrieveHandoff(HANDOFF_ID)).resolves.toEqual(
      expect.objectContaining({ refreshToken: expect.any(String) }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("times out an indefinitely processing handoff", async () => {
    jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((callback: () => void) => {
        callback();
        return 0;
      }) as typeof setTimeout);
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: "handoff_processing" }), {
        status: 202,
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.retrieveHandoff(HANDOFF_ID)).rejects.toThrow(
      "Timed out waiting for the OAuth relay handoff",
    );
    expect(fetcher).toHaveBeenCalledTimes(60);
  });

  it("rejects invalid handoff identifiers and refresh responses", async () => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(JSON.stringify({ status: "invalid" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.retrieveHandoff("invalid")).rejects.toThrow(
      "OAuth relay handoff ID is invalid",
    );
    await expect(
      client.refresh(
        "refresh-token-with-at-least-twenty-characters",
        "refresh-attempt-00000001",
      ),
    ).rejects.toThrow("OAuth relay returned an invalid refresh handoff");
  });

  it.each([
    { body: "not-json", contentType: "text/plain" },
    { body: "null", contentType: "application/json" },
    { body: "[]", contentType: "application/json" },
    { body: "\"scalar\"", contentType: "application/json" },
  ])("rejects malformed relay response %#", async ({ body, contentType }) => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": contentType },
      }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.connectionStatus()).rejects.toThrow(
      "OAuth relay returned an invalid response",
    );
  });

  it("redacts relay response bodies from errors", async () => {
    const fetcher: typeof fetch = jest.fn(async () =>
      new Response("sensitive upstream body", { status: 502 }),
    ) as typeof fetch;
    const client = new OAuthRelayClient(
      "https://oauth.vantasoft.com",
      CONNECTION_ID,
      RELAY_TOKEN,
      fetcher,
    );
    await expect(client.connectionStatus()).rejects.toThrow(
      "OAuth relay request failed with HTTP 502",
    );
  });
});
