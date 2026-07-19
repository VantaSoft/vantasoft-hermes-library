"""Hermes tool handlers for peer-agent discovery and messaging."""

from __future__ import annotations

import re
import subprocess  # nosec B404
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from tools.registry import tool_error, tool_result

from . import native_child, origin_reply
from .paths import (
    active_profile_name,
    hermes_executable,
    hermes_root,
    list_profiles,
    normalize_profile_name,
    profile_exists,
    profile_home,
    profile_subprocess_environment,
)
from .schemas import MAX_MESSAGE_CHARS

_MESSAGE_ID_PATTERN = re.compile(r"msg_[a-f0-9]{32}")
_REPLY_KINDS = {"ack", "progress", "final", "blocker", "error"}


def _latest_session_id_for_source(
    agent: str,
    source: str,
    target_home: Path,
) -> str | None:
    # Profile and source values are passed as separate argv entries.
    completed = subprocess.run(  # nosec B603
        [
            hermes_executable(),
            "--profile",
            agent,
            "sessions",
            "list",
            "--source",
            source,
            "--limit",
            "1",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(target_home),
        env=profile_subprocess_environment(),
        check=False,
    )
    if completed.returncode != 0:
        return None
    for line in (completed.stdout or "").splitlines():
        match = re.search(r"\b(\d{8}_\d{6}_[A-Za-z0-9]+)\b\s*$", line)
        if match:
            return match.group(1)
    return None


def _profile_to_dict(profile: Any, active: str | None = None) -> dict[str, Any]:
    name = str(getattr(profile, "name", ""))
    return {
        "name": name,
        "is_default": bool(getattr(profile, "is_default", False)),
        "is_active": bool(active and name == active),
        "gateway_running": bool(getattr(profile, "gateway_running", False)),
        "model": getattr(profile, "model", None),
        "provider": getattr(profile, "provider", None),
        "description": getattr(profile, "description", "") or "",
    }


def handle_list_agents(args: dict[str, Any], **kwargs: Any) -> str:
    del args, kwargs
    active = active_profile_name()
    agents = [_profile_to_dict(profile, active) for profile in list_profiles()]
    return tool_result(
        success=True,
        active_profile=active,
        count=len(agents),
        agents=agents,
    )


def handle_agent_status(args: dict[str, Any], **kwargs: Any) -> str:
    del kwargs
    agent = normalize_profile_name(args.get("agent"))
    if not agent:
        return tool_error("agent is required", success=False)
    if not profile_exists(agent):
        return tool_error(
            f"Agent/profile {agent!r} does not exist",
            success=False,
            agent=agent,
        )

    active = active_profile_name()
    for profile in list_profiles():
        if getattr(profile, "name", "") == agent:
            return tool_result(success=True, agent=_profile_to_dict(profile, active))

    return tool_result(
        success=True,
        agent={
            "name": agent,
            "is_default": agent == "default",
            "is_active": agent == active,
            "gateway_running": False,
            "model": None,
            "provider": None,
            "description": "",
        },
    )


def _build_agent_prompt(
    message: str,
    message_id: str,
    sender: str,
    *,
    conversation_id: str,
    resumed: bool,
) -> str:
    continuation = (
        "This run resumes the target context from an earlier peer conversation.\n"
        if resumed
        else "This run starts a new peer conversation.\n"
    )
    return (
        f"You received an asynchronous request from Hermes profile {sender!r}.\n"
        f"Message ID: {message_id}\n"
        f"Conversation ID: {conversation_id}\n"
        f"{continuation}\n"
        "Run with your own profile identity, memory, skills, tools, and credentials.\n"
        "Reply contract:\n"
        f"* For a material task, call agent_reply with message_id={message_id!r} and "
        "kind='ack' before continuing.\n"
        f"* Use kind='progress' for meaningful updates, kind='blocker' when a decision is "
        "required, and kind='error' when work cannot continue.\n"
        f"* After the work is complete, your last tool call must be agent_reply with "
        f"message_id={message_id!r}, kind='final', and the complete result.\n"
        "* After a terminal reply (final, blocker, or error), stop the run.\n"
        "* Normal assistant output is retained only in the target session and is not "
        "delivered to the sender.\n\n"
        f"Request:\n{message.strip()}"
    )


def handle_agent_reply(args: dict[str, Any], **kwargs: Any) -> str:
    del kwargs
    message_id = str(args.get("message_id") or "").strip()
    kind = str(args.get("kind") or "progress").strip().lower()
    message = str(args.get("message") or "").strip()
    if not _MESSAGE_ID_PATTERN.fullmatch(message_id):
        return tool_error(
            "A valid asynchronous agent message_id is required",
            success=False,
        )
    if kind not in _REPLY_KINDS:
        return tool_error(
            "kind must be ack, progress, final, blocker, or error",
            success=False,
        )
    if not message:
        return tool_error("message is required", success=False, message_id=message_id)
    if len(message) > MAX_MESSAGE_CHARS:
        return tool_error(
            f"message exceeds the {MAX_MESSAGE_CHARS}-character limit",
            success=False,
            message_id=message_id,
        )

    context = origin_reply.reply_context_from_env()
    if not context.get("message_id"):
        return tool_error(
            "agent_reply is available only inside a message_agent child run",
            success=False,
            message_id=message_id,
        )
    if message_id != context["message_id"]:
        return tool_error(
            "message_id does not match the active peer-agent run",
            success=False,
            message_id=message_id,
        )

    active = active_profile_name()
    if active != context.get("sender_profile"):
        return tool_error(
            f"Active profile {active!r} does not own this peer-agent run",
            success=False,
            message_id=message_id,
        )

    try:
        appended = origin_reply.append_origin_reply(
            origin_profile=context["origin_profile"],
            origin_session_id=context["origin_session_id"],
            sender_profile=active,
            message_id=message_id,
            conversation_id=context.get("conversation_id") or message_id,
            kind=kind,
            body=message,
        )
    except Exception as exc:
        return tool_error(
            f"Failed to append agent reply: {type(exc).__name__}: {exc}",
            success=False,
            message_id=message_id,
        )

    return tool_result(
        success=True,
        delivery="origin_session_append",
        waited=False,
        message_id=message_id,
        conversation_id=context.get("conversation_id") or message_id,
        kind=kind,
        appended=bool(appended.get("appended")),
        deduplicated=bool(appended.get("deduplicated")),
        origin_profile=appended.get("origin_profile"),
        origin_session_id=appended.get("origin_session_id"),
        platform_message_id=appended.get("platform_message_id"),
    )


def handle_message_agent(args: dict[str, Any], **kwargs: Any) -> str:
    agent = normalize_profile_name(args.get("agent"))
    message = str(args.get("message") or "").strip()
    reply_to = str(args.get("reply_to") or "").strip()

    if not agent:
        return tool_error("agent is required", success=False)
    if not message:
        return tool_error("message is required", success=False, agent=agent)
    if len(message) > MAX_MESSAGE_CHARS:
        return tool_error(
            f"message exceeds the {MAX_MESSAGE_CHARS}-character limit",
            success=False,
            agent=agent,
        )
    unsupported = [
        name for name in ("mode", "thread", "timeout_seconds") if name in args
    ]
    if unsupported:
        return tool_error(
            "message_agent is async-only; remove unsupported option(s): "
            + ", ".join(unsupported),
            success=False,
            agent=agent,
            unsupported_options=unsupported,
        )
    if reply_to and not _MESSAGE_ID_PATTERN.fullmatch(reply_to):
        return tool_error(
            "reply_to must be a valid conversation ID",
            success=False,
            agent=agent,
            reply_to=reply_to,
        )
    if not profile_exists(agent):
        return tool_error(
            f"Agent/profile {agent!r} does not exist",
            success=False,
            agent=agent,
        )

    active = active_profile_name()
    if agent == active:
        return tool_error(
            "Cannot message the active profile; choose a different target.",
            success=False,
            agent=agent,
        )

    target_home = profile_home(agent)
    origin_session_id = str(kwargs.get("session_id") or "").strip()
    if not origin_session_id:
        return tool_error(
            "Agent messaging requires an originating Hermes session.",
            success=False,
            agent=agent,
        )
    try:
        origin_session_id = origin_reply.resolve_origin_session(active, origin_session_id)
    except Exception as exc:
        return tool_error(
            f"Could not resolve the initiating session: {type(exc).__name__}: {exc}",
            success=False,
            agent=agent,
            origin_session_id=origin_session_id,
        )

    message_id = f"msg_{uuid.uuid4().hex}"
    conversation_id = reply_to or message_id
    source = f"agent-message:{active}:{conversation_id}"
    target_session_id = None
    resumed = False
    if reply_to:
        target_session_id = _latest_session_id_for_source(agent, source, target_home)
        if not target_session_id:
            return tool_error(
                "No completed conversation was found for reply_to in the target profile",
                success=False,
                agent=agent,
                reply_to=reply_to,
                conversation_id=conversation_id,
            )
        resumed = True

    created_at = datetime.now(UTC).isoformat()
    prompt = _build_agent_prompt(
        message,
        message_id,
        active,
        conversation_id=conversation_id,
        resumed=resumed,
    )
    job = {
        "message_id": message_id,
        "conversation_id": conversation_id,
        "sender_profile": active,
        "target_profile": agent,
        "origin_profile": active,
        "origin_session_id": origin_session_id,
        "target_home": str(target_home),
        "hermes_root": str(hermes_root()),
        "prompt": prompt,
        "source": source,
        "target_session_id": target_session_id,
        "created_at": created_at,
    }
    try:
        route = native_child.current_origin_route(
            fallback_session_key=str(
                kwargs.get("task_id")
                or kwargs.get("session_key")
                or origin_session_id
            )
        )
        worker = native_child.spawn_profile_child(job, route=route)
    except Exception as exc:
        return tool_error(
            f"Failed to start tracked target run: {type(exc).__name__}: {exc}",
            success=False,
            agent=agent,
        )

    return tool_result(
        success=True,
        agent=agent,
        from_agent=active,
        delivery="tracked_profile_child",
        status="running",
        accepted=True,
        tracked=bool(worker.get("tracked")),
        notify_on_complete=bool(worker.get("notify_on_complete")),
        completion_handling="automatic_parent_resume",
        waited=False,
        message_id=message_id,
        conversation_id=conversation_id,
        reply_to=reply_to or None,
        resumed=resumed,
        session_id=target_session_id,
        source=source,
        origin_profile=active,
        origin_session_id=origin_session_id,
        created_at=created_at,
    )
