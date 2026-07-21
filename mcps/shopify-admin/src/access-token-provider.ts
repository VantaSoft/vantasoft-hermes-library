import type { ShopifyConfig, StoreConfig } from "./config.js";
import { getStore, UserInputError } from "./config.js";

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class AccessTokenProvider {
  private readonly cache = new Map<string, CachedToken>();

  constructor(
    private readonly config: ShopifyConfig,
    private readonly fetchApi: typeof fetch = fetch,
  ) {}

  async get(requestedStore?: string): Promise<{
    name: string;
    store: StoreConfig;
    accessToken: string;
  }> {
    const selected = getStore(this.config, requestedStore);
    if (selected.config.accessToken) {
      return {
        name: selected.name,
        store: selected.config,
        accessToken: selected.config.accessToken,
      };
    }

    const cached = this.cache.get(selected.name);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return {
        name: selected.name,
        store: selected.config,
        accessToken: cached.value,
      };
    }

    const token = await this.requestClientCredentialsToken(selected.config);
    this.cache.set(selected.name, token);
    return {
      name: selected.name,
      store: selected.config,
      accessToken: token.value,
    };
  }

  private async requestClientCredentialsToken(
    store: StoreConfig,
  ): Promise<CachedToken> {
    if (!store.clientId || !store.clientSecret) {
      throw new UserInputError("Shopify client credentials are incomplete");
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: store.clientId,
      client_secret: store.clientSecret,
    });
    const response = await this.fetchApi(
      `https://${store.shopDomain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw Object.assign(new Error("Shopify token request failed"), {
        statusCode: response.status,
      });
    }
    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.expires_in !== "number" ||
      !Number.isFinite(payload.expires_in)
    ) {
      throw new Error("Shopify token response was invalid");
    }
    return {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
  }
}
