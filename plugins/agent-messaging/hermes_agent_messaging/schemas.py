"""Tool schemas exposed by the plugin."""

MAX_MESSAGE_CHARS = 65_536

LIST_AGENTS = {
    "name": "list_agents",
    "description": (
        "List Hermes profiles that can act as peer agents. Returns profile names, "
        "descriptions, model/provider metadata, and gateway-running status."
    ),
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}

AGENT_STATUS = {
    "name": "agent_status",
    "description": "Show status and metadata for one Hermes profile.",
    "parameters": {
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Target Hermes profile name.",
            }
        },
        "required": ["agent"],
        "additionalProperties": False,
    },
}

MESSAGE_AGENT = {
    "name": "message_agent",
    "description": (
        "Start a Hermes-tracked full-profile child run in another profile and return "
        "immediately. The target sends acknowledgments, progress, blockers, and an explicit "
        "final result to the initiating session with agent_reply. Native process completion "
        "then resumes the parent session. Pass reply_to from a completed conversation to "
        "resume that target context. Use this for bounded peer work; use a durable task board "
        "for dependencies, retries, or work that must survive restarts. Keep the request terse "
        "and never include secret values. Do not poll, wait on, or inspect the private child "
        "process."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Target Hermes profile name.",
            },
            "message": {
                "type": "string",
                "description": "Instructions for the target profile.",
                "maxLength": MAX_MESSAGE_CHARS,
            },
            "reply_to": {
                "type": "string",
                "description": "Conversation ID returned by a completed message_agent run.",
            },
        },
        "required": ["agent", "message"],
        "additionalProperties": False,
    },
}

AGENT_REPLY = {
    "name": "agent_reply",
    "description": (
        "Append an acknowledgment, progress update, blocker, error, or final result directly "
        "to the Hermes session that initiated the active message_agent run. Normal assistant "
        "output is not forwarded. Return the concrete result or precise blocker, without "
        "secret values or conversational filler. The target must use kind='final' for a "
        "successful result."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "message_id": {
                "type": "string",
                "description": "Message ID from the active peer-agent request.",
            },
            "kind": {
                "type": "string",
                "enum": ["ack", "progress", "final", "blocker", "error"],
                "default": "progress",
            },
            "message": {
                "type": "string",
                "description": "Concise update or result text.",
                "maxLength": MAX_MESSAGE_CHARS,
            },
        },
        "required": ["message_id", "message"],
        "additionalProperties": False,
    },
}
