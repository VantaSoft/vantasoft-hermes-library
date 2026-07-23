const HANDOFF_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$/;

export interface RelayTokenBundle {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt?: number;
  providerMetadata: Record<string, string>;
}

export interface RelayConnectionStatus {
  connectionId: string;
  provider: "intuit";
  status: string;
  handoffId: string | null;
}

export class OAuthRelayClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly connectionId: string,
    private readonly relayToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("OAUTH_RELAY_URL must be an HTTPS origin");
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        connectionId,
      )
    ) {
      throw new Error("OAUTH_CONNECTION_ID must be a UUID");
    }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(relayToken)) {
      throw new Error("OAUTH_RELAY_TOKEN is invalid");
    }
    this.baseUrl = url.origin;
  }

  async connectionStatus(): Promise<RelayConnectionStatus> {
    const value = await this.request(
      `/v1/oauth/connections/${this.connectionId}`,
      { method: "GET" },
    );
    if (
      typeof value.connectionId !== "string" ||
      value.connectionId !== this.connectionId ||
      value.provider !== "intuit" ||
      typeof value.status !== "string" ||
      (value.handoffId !== null && typeof value.handoffId !== "string")
    ) {
      throw new Error("OAuth relay returned an invalid connection status");
    }
    return value as unknown as RelayConnectionStatus;
  }

  async retrieveHandoff(handoffId: string): Promise<RelayTokenBundle> {
    this.validateHandoffId(handoffId);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await this.request(`/v1/oauth/handoffs/${handoffId}`, {
        method: "GET",
      });
      if (value.error === "handoff_processing") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (
        typeof value.accessToken !== "string" ||
        value.accessToken.length < 20 ||
        typeof value.refreshToken !== "string" ||
        value.refreshToken.length < 20 ||
        typeof value.accessTokenExpiresAt !== "number" ||
        !Number.isSafeInteger(value.accessTokenExpiresAt) ||
        !value.providerMetadata ||
        typeof value.providerMetadata !== "object" ||
        Array.isArray(value.providerMetadata)
      ) {
        throw new Error("OAuth relay returned an invalid token handoff");
      }
      return value as unknown as RelayTokenBundle;
    }
    throw new Error("Timed out waiting for the OAuth relay handoff");
  }

  async acknowledgeHandoff(handoffId: string): Promise<void> {
    this.validateHandoffId(handoffId);
    await this.request(`/v1/oauth/handoffs/${handoffId}/acknowledge`, {
      method: "POST",
    });
  }

  async refresh(
    refreshToken: string,
    idempotencyKey: string,
  ): Promise<string> {
    const value = await this.request(
      `/v1/oauth/connections/${this.connectionId}/refresh`,
      {
        method: "POST",
        body: JSON.stringify({ refreshToken, idempotencyKey }),
      },
    );
    if (typeof value.handoffId !== "string") {
      throw new Error("OAuth relay returned an invalid refresh handoff");
    }
    this.validateHandoffId(value.handoffId);
    return value.handoffId;
  }

  async revoke(token: string): Promise<void> {
    await this.request(`/v1/oauth/connections/${this.connectionId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  private validateHandoffId(handoffId: string): void {
    if (!HANDOFF_ID_PATTERN.test(handoffId)) {
      throw new Error("OAuth relay handoff ID is invalid");
    }
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST"; body?: string },
  ): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.relayToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`OAuth relay request failed with HTTP ${response.status}`);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("OAuth relay returned an invalid response");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("OAuth relay returned an invalid response");
    }
    return value as Record<string, unknown>;
  }
}
