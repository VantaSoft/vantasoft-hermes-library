"""Idempotent delivery of peer replies into the initiating Hermes session."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Any

from .paths import profile_home

_VALID_PROFILE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_VALID_KIND = {"ack", "progress", "final", "blocker", "error"}
_TERMINAL_KINDS = {"final", "blocker", "error"}


def reply_platform_id(message_id: str, kind: str, body: str) -> str:
    if kind in _TERMINAL_KINDS:
        suffix = "terminal"
    else:
        suffix = hashlib.sha256(body.encode("utf-8")).hexdigest()[:20]
    normalized_kind = "terminal" if kind in _TERMINAL_KINDS else kind
    return f"agent-reply:{message_id}:{normalized_kind}:{suffix}"


def format_reply(
    sender_profile: str,
    message_id: str,
    kind: str,
    body: str,
    *,
    conversation_id: str | None = None,
) -> str:
    conversation = str(conversation_id or message_id).strip()
    conversation_suffix = f" | conversation {conversation}" if conversation != message_id else ""
    return (
        f"[Agent reply from {sender_profile} | {kind} | message {message_id}"
        f"{conversation_suffix}]\n{body.strip()}"
    )


@contextmanager
def _reply_lock(origin_home: Path) -> Iterator[None]:
    lock_path = origin_home / "tmp" / "agent-messaging-replies.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+")
    try:
        with suppress(OSError):
            lock_path.chmod(0o600)
        if os.name == "posix":
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        if os.name == "posix":
            try:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        handle.close()


def _session_db_class():
    from hermes_state import SessionDB

    return SessionDB


def _profile_has_platform_message_id(db_path: Path, platform_message_id: str) -> bool:
    database_uri = db_path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(database_uri, uri=True, timeout=10.0)
    try:
        row = connection.execute(
            "SELECT 1 FROM messages WHERE platform_message_id = ? LIMIT 1",
            (platform_message_id,),
        ).fetchone()
        return row is not None
    finally:
        connection.close()


def resolve_origin_session(origin_profile: str, origin_session_id: str) -> str:
    origin_home = profile_home(origin_profile)
    session_id = str(origin_session_id or "").strip()
    if not session_id:
        raise ValueError("Origin session ID is required")

    session_db = _session_db_class()(db_path=origin_home / "state.db", read_only=True)
    try:
        canonical_session_id = session_db.get_compression_tip(session_id) or session_id
        if session_db.get_session(canonical_session_id) is None:
            raise LookupError(
                f"Origin session {session_id!r} is not present in profile {origin_profile!r}"
            )
        return canonical_session_id
    finally:
        session_db.close()


def append_origin_reply(
    *,
    origin_profile: str,
    origin_session_id: str,
    sender_profile: str,
    message_id: str,
    conversation_id: str | None = None,
    kind: str,
    body: str,
) -> dict[str, Any]:
    """Idempotently append one peer reply to the initiating session."""

    kind = str(kind or "").strip().lower()
    body = str(body or "").strip()
    session_id = str(origin_session_id or "").strip()
    sender = str(sender_profile or "").strip().lower()
    if kind not in _VALID_KIND:
        raise ValueError(f"Unsupported agent reply kind: {kind!r}")
    if not body:
        raise ValueError("Agent reply body is required")
    if not session_id:
        raise ValueError("Origin session ID is required")
    if not _VALID_PROFILE.fullmatch(sender):
        raise ValueError(f"Invalid sender profile: {sender_profile!r}")

    origin_home = profile_home(origin_profile)
    platform_id = reply_platform_id(message_id, kind, body)
    content = format_reply(
        sender,
        message_id,
        kind,
        body,
        conversation_id=conversation_id,
    )
    session_db_class = _session_db_class()

    with _reply_lock(origin_home):
        db_path = origin_home / "state.db"
        session_db = session_db_class(db_path=db_path)
        try:
            canonical_session_id = session_db.get_compression_tip(session_id) or session_id
            if session_db.get_session(canonical_session_id) is None:
                raise LookupError(
                    f"Origin session {session_id!r} is not present in profile "
                    f"{origin_profile!r}"
                )
            terminal_platform_id = reply_platform_id(message_id, "final", "terminal")
            if kind not in _TERMINAL_KINDS and _profile_has_platform_message_id(
                db_path, terminal_platform_id
            ):
                return {
                    "success": True,
                    "appended": False,
                    "deduplicated": True,
                    "terminal_closed": True,
                    "origin_profile": origin_profile,
                    "origin_session_id": canonical_session_id,
                    "platform_message_id": terminal_platform_id,
                }
            if _profile_has_platform_message_id(db_path, platform_id):
                return {
                    "success": True,
                    "appended": False,
                    "deduplicated": True,
                    "origin_profile": origin_profile,
                    "origin_session_id": canonical_session_id,
                    "platform_message_id": platform_id,
                }
            row_id = session_db.append_message(
                session_id=canonical_session_id,
                role="user",
                content=content,
                platform_message_id=platform_id,
                observed=False,
            )
            return {
                "success": True,
                "appended": True,
                "deduplicated": False,
                "origin_profile": origin_profile,
                "origin_session_id": canonical_session_id,
                "platform_message_id": platform_id,
                "row_id": row_id,
            }
        finally:
            session_db.close()


def reply_context_from_env() -> dict[str, str]:
    return {
        "message_id": str(os.getenv("HERMES_AGENT_MESSAGE_ID") or "").strip(),
        "conversation_id": str(os.getenv("HERMES_AGENT_CONVERSATION_ID") or "").strip(),
        "origin_profile": str(os.getenv("HERMES_AGENT_ORIGIN_PROFILE") or "").strip(),
        "origin_session_id": str(os.getenv("HERMES_AGENT_ORIGIN_SESSION_ID") or "").strip(),
        "sender_profile": str(os.getenv("HERMES_AGENT_TARGET_PROFILE") or "").strip(),
        "request_sender_profile": str(
            os.getenv("HERMES_AGENT_SENDER_PROFILE") or ""
        ).strip(),
    }
