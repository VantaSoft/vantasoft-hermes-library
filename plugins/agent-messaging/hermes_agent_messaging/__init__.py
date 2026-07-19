"""Agent Messaging plugin registration."""

from __future__ import annotations

from . import schemas, tools
from .compat import ensure_compatible_runtime

__version__ = "0.3.0"


def register(ctx) -> None:
    """Register peer-agent tools with Hermes."""

    ensure_compatible_runtime()
    ctx.register_tool(
        name="list_agents",
        toolset="agent_messaging",
        schema=schemas.LIST_AGENTS,
        handler=tools.handle_list_agents,
        description="List Hermes profiles available as peer agents.",
        emoji="👥",
    )
    ctx.register_tool(
        name="agent_status",
        toolset="agent_messaging",
        schema=schemas.AGENT_STATUS,
        handler=tools.handle_agent_status,
        description="Show metadata and gateway status for one Hermes profile.",
        emoji="🩺",
    )
    ctx.register_tool(
        name="message_agent",
        toolset="agent_messaging",
        schema=schemas.MESSAGE_AGENT,
        handler=tools.handle_message_agent,
        description="Start a tracked asynchronous run in another Hermes profile.",
        emoji="📨",
    )
    ctx.register_tool(
        name="agent_reply",
        toolset="agent_messaging",
        schema=schemas.AGENT_REPLY,
        handler=tools.handle_agent_reply,
        description="Return an explicit update or result to the initiating profile.",
        emoji="↩️",
    )


__all__ = ["__version__", "register"]
