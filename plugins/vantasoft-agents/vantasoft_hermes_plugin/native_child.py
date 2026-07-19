"""Hermes-native tracked child execution for cross-profile agent runs."""

from __future__ import annotations

import json
import shlex
import shutil
import sys
from collections.abc import Mapping
from contextlib import suppress
from pathlib import Path
from typing import Any

from .paths import profile_subprocess_environment
from .retention import prune_failure_logs

_REQUIRED_ROUTE_KEYS = (
    "session_key",
    "platform",
    "chat_id",
    "thread_id",
    "user_id",
    "user_name",
    "message_id",
)


def current_origin_route(*, fallback_session_key: str = "") -> dict[str, str]:
    """Capture the initiating session's native completion route."""

    from gateway.session_context import async_delivery_supported, get_session_env

    if not async_delivery_supported():
        raise RuntimeError("This Hermes channel cannot receive asynchronous completions")

    values = {
        "session_key": get_session_env("HERMES_SESSION_KEY", "") or fallback_session_key,
        "platform": get_session_env("HERMES_SESSION_PLATFORM", ""),
        "chat_id": get_session_env("HERMES_SESSION_CHAT_ID", ""),
        "thread_id": get_session_env("HERMES_SESSION_THREAD_ID", ""),
        "user_id": get_session_env("HERMES_SESSION_USER_ID", ""),
        "user_name": get_session_env("HERMES_SESSION_USER_NAME", ""),
        "message_id": get_session_env("HERMES_SESSION_MESSAGE_ID", ""),
    }
    return {key: str(value or "") for key, value in values.items()}


def _configure_completion_watcher(
    registry: Any,
    process_session: Any,
    route: Mapping[str, str],
    *,
    interval: int = 2,
) -> None:
    """Attach Hermes's notify-on-complete watcher and persist its route."""

    missing = [key for key in _REQUIRED_ROUTE_KEYS if key not in route]
    if missing:
        raise ValueError(f"Incomplete origin route; missing: {', '.join(missing)}")

    process_session.notify_on_complete = True
    process_session.watcher_platform = str(route.get("platform") or "")
    process_session.watcher_chat_id = str(route.get("chat_id") or "")
    process_session.watcher_thread_id = str(route.get("thread_id") or "")
    process_session.watcher_user_id = str(route.get("user_id") or "")
    process_session.watcher_user_name = str(route.get("user_name") or "")
    process_session.watcher_message_id = str(route.get("message_id") or "")
    if process_session.watcher_platform:
        process_session.watcher_interval = max(1, int(interval))

    checkpoint = getattr(registry, "_write_checkpoint", None)
    if not callable(checkpoint):
        raise RuntimeError("Hermes cannot persist completion watcher metadata")
    checkpoint()

    if process_session.watcher_platform:
        registry.pending_watchers.append(
            {
                "session_id": process_session.id,
                "check_interval": process_session.watcher_interval,
                "session_key": str(route.get("session_key") or ""),
                "platform": process_session.watcher_platform,
                "chat_id": process_session.watcher_chat_id,
                "thread_id": process_session.watcher_thread_id,
                "user_id": process_session.watcher_user_id,
                "user_name": process_session.watcher_user_name,
                "message_id": process_session.watcher_message_id,
                "notify_on_complete": True,
            }
        )


def spawn_profile_child(
    job: Mapping[str, Any],
    *,
    route: Mapping[str, str],
    registry: Any | None = None,
) -> dict[str, Any]:
    """Launch one full-profile child through Hermes's process registry."""

    effective_registry = registry
    if effective_registry is None:
        from tools.process_registry import process_registry

        effective_registry = process_registry

    target_home = Path(str(job["target_home"]))
    runtime_dir = target_home / "tmp" / "vantasoft-agent-messages"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    prune_failure_logs(runtime_dir)
    message_id = str(job["message_id"])
    job_path = runtime_dir / f"{message_id}.json"
    log_path = runtime_dir / f"{message_id}.log"

    env_executable = shutil.which("env")
    if not env_executable:
        raise RuntimeError(
            "Secure peer-agent launch requires an env executable with env -i support"
        )

    job_path.write_text(json.dumps(dict(job), sort_keys=True), encoding="utf-8")
    with suppress(OSError):
        job_path.chmod(0o600)

    worker_path = Path(__file__).with_name("worker.py")
    worker_argv = [sys.executable, "-I", str(worker_path), str(job_path), str(log_path)]
    narrow_environment = profile_subprocess_environment(root=str(job["hermes_root"]))
    worker_argv = [
        env_executable,
        "-i",
        *(f"{key}={value}" for key, value in sorted(narrow_environment.items())),
        *worker_argv,
    ]
    command = "exec " + " ".join(shlex.quote(value) for value in worker_argv)
    process_session = None
    try:
        process_session = effective_registry.spawn_local(
            command=command,
            cwd=str(target_home),
            task_id=f"agent-message:{message_id}",
            session_key=str(route.get("session_key") or ""),
            env_vars={
                "HERMES_HOME": str(job["hermes_root"]),
                "PYTHONUNBUFFERED": "1",
            },
            use_pty=False,
        )
        _configure_completion_watcher(effective_registry, process_session, route)
    except Exception:
        if process_session is not None:
            kill = getattr(effective_registry, "kill_process", None)
            if callable(kill):
                with suppress(Exception):
                    kill(process_session.id, source="vantasoft_agents_watcher_setup")
        job_path.unlink(missing_ok=True)
        raise

    return {
        "pid": process_session.pid,
        "process_id": process_session.id,
        "job_path": str(job_path),
        "log_path": str(log_path),
        "tracked": True,
        "notify_on_complete": True,
    }
