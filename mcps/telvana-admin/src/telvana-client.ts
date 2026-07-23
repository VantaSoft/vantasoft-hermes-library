import { TelvanaApiError } from "./errors.js";
import type { TelvanaConfig } from "./config.js";

export type FetchImplementation = typeof fetch;

function safeRequestId(response: Response): string | undefined {
  const value = response.headers.get("x-request-id");
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

export class TelvanaClient {
  constructor(
    private readonly config: TelvanaConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private async request(
    method: "GET" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await this.fetchImplementation(
        new URL(route.replace(/^\//, ""), `${this.config.baseUrl}/`),
        {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new TelvanaApiError(response.status, safeRequestId(response));
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new TelvanaApiError(response.status, safeRequestId(response));
      }

      if (parsed && typeof parsed === "object" && "data" in parsed) {
        return (parsed as { data: unknown }).data;
      }
      return parsed;
    } catch (error) {
      if (error instanceof TelvanaApiError) throw error;
      throw new TelvanaApiError();
    } finally {
      clearTimeout(timeout);
    }
  }

  getAgent(agentId: string): Promise<unknown> {
    return this.request("GET", `agent/${encodeURIComponent(agentId)}`);
  }

  listOutboundPrompts(agentId: string): Promise<unknown> {
    return this.request(
      "GET",
      `agent/${encodeURIComponent(agentId)}/outbound-prompts`,
    );
  }

  getOutboundPrompt(agentId: string, promptId: string): Promise<unknown> {
    return this.request(
      "GET",
      `agent/${encodeURIComponent(agentId)}/outbound-prompts/${encodeURIComponent(promptId)}`,
    );
  }

  updateInboundPrompt(
    agentId: string,
    inboundPrompt: string,
  ): Promise<unknown> {
    return this.request(
      "PUT",
      `agent/${encodeURIComponent(agentId)}/inbound-prompt`,
      { inboundPrompt },
    );
  }

  updateAgentSettings(
    agentId: string,
    settings: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      "PUT",
      `agent/${encodeURIComponent(agentId)}/settings`,
      settings,
    );
  }

  updateOutboundPrompt(
    agentId: string,
    promptId: string,
    update: { title?: string; instructions?: string },
  ): Promise<unknown> {
    return this.request(
      "PUT",
      `agent/${encodeURIComponent(agentId)}/outbound-prompts/${encodeURIComponent(promptId)}`,
      update,
    );
  }
}
