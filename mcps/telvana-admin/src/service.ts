import type { TelvanaConfig } from "./config.js";
import { TelvanaClient } from "./telvana-client.js";

export class TelvanaService {
  constructor(
    private readonly config: TelvanaConfig,
    private readonly client: TelvanaClient,
  ) {}

  getServerInfo(): object {
    return {
      environment: this.config.environment,
      baseUrl: this.config.baseUrl,
      actor: this.config.actor,
      mutationsEnabled: this.config.mutationsEnabled,
      destructiveToolsAvailable: false,
    };
  }

  getAgent(agentId: string): Promise<unknown> {
    return this.client.getAgent(agentId);
  }

  listOutboundPrompts(agentId: string): Promise<unknown> {
    return this.client.listOutboundPrompts(agentId);
  }

  getOutboundPrompt(agentId: string, promptId: string): Promise<unknown> {
    return this.client.getOutboundPrompt(agentId, promptId);
  }

  updateInboundPrompt(
    agentId: string,
    inboundPrompt: string,
  ): Promise<unknown> {
    return this.client.updateInboundPrompt(agentId, inboundPrompt);
  }

  updateAgentSettings(
    agentId: string,
    settings: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.updateAgentSettings(agentId, settings);
  }

  updateOutboundPrompt(
    agentId: string,
    promptId: string,
    update: { title?: string; instructions?: string },
  ): Promise<unknown> {
    return this.client.updateOutboundPrompt(agentId, promptId, update);
  }
}
