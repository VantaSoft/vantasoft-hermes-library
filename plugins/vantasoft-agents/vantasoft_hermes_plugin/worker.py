"""Detached worker for one tracked cross-profile Hermes run."""

from __future__ import annotations

import json
import os
import subprocess  # nosec B404
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any

_BOOTSTRAP_ENV_ALLOWLIST = frozenset(
    {
        "COLORTERM",
        "CURL_CA_BUNDLE",
        "HERMES_CODEX_AUTH_FILE",
        "HERMES_HOME",
        "HOME",
        "LANG",
        "LOGNAME",
        "NODE_EXTRA_CA_CERTS",
        "PATH",
        "PYTHONUNBUFFERED",
        "REQUESTS_CA_BUNDLE",
        "SHELL",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "TEMP",
        "TERM",
        "TMP",
        "TMPDIR",
        "TZ",
        "USER",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_RUNTIME_DIR",
    }
)


def _narrow_worker_environment(source: dict[str, str]) -> dict[str, str]:
    """Remove unknown sender-profile variables before loading plugin modules."""

    return {
        key: str(value)
        for key, value in source.items()
        if key in _BOOTSTRAP_ENV_ALLOWLIST or key.startswith("LC_")
    }


if __name__ == "__main__":
    _bootstrap_environment = _narrow_worker_environment(dict(os.environ))
    os.environ.clear()
    os.environ.update(_bootstrap_environment)

if __package__:
    from .origin_reply import append_origin_reply
    from .paths import profile_subprocess_environment
    from .retention import finalize_log, mark_log_active, prune_failure_logs, unmark_log_active
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from vantasoft_hermes_plugin.origin_reply import append_origin_reply
    from vantasoft_hermes_plugin.paths import profile_subprocess_environment
    from vantasoft_hermes_plugin.retention import (
        finalize_log,
        mark_log_active,
        prune_failure_logs,
        unmark_log_active,
    )

_PIPE_GUARDS: list[int] = []

def _redirect_diagnostics(log_path: Path) -> None:
    """Redirect diagnostics while keeping Hermes's child pipe open until exit."""

    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        pipe_guard = os.dup(sys.stdout.fileno())
        os.dup2(log_fd, sys.stdout.fileno())
        os.dup2(log_fd, sys.stderr.fileno())
    finally:
        os.close(log_fd)
    _PIPE_GUARDS.append(pipe_guard)


def _restore_diagnostics() -> None:
    """Restore the tracked-process pipe before rotating or deleting its log."""

    with suppress(Exception):
        sys.stdout.flush()
        sys.stderr.flush()
    while _PIPE_GUARDS:
        pipe_guard = _PIPE_GUARDS.pop()
        try:
            os.dup2(pipe_guard, sys.stdout.fileno())
            os.dup2(pipe_guard, sys.stderr.fileno())
        finally:
            os.close(pipe_guard)


def _target_environment(
    job: dict[str, Any],
    source: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build a narrow environment and let the target profile load its own .env."""

    return profile_subprocess_environment(
        root=str(job["hermes_root"]),
        source=source,
        extra={
            "HERMES_AGENT_MESSAGE_ID": str(job["message_id"]),
            "HERMES_AGENT_CONVERSATION_ID": str(
                job.get("conversation_id") or job["message_id"]
            ),
            "HERMES_AGENT_ORIGIN_PROFILE": str(job["origin_profile"]),
            "HERMES_AGENT_ORIGIN_SESSION_ID": str(job["origin_session_id"]),
            "HERMES_AGENT_SENDER_PROFILE": str(job["sender_profile"]),
            "HERMES_AGENT_TARGET_PROFILE": str(job["target_profile"]),
        },
    )


def run_job(job: dict[str, Any]) -> int:
    message_id = str(job["message_id"])
    conversation_id = str(job.get("conversation_id") or message_id)
    target_profile = str(job["target_profile"])
    target_runner = Path(__file__).with_name("target_runner.py")
    command = [sys.executable, "-I", str(target_runner)]
    target_payload = {
        "target_profile": target_profile,
        "prompt": str(job["prompt"]),
        "source": str(job["source"]),
        "target_session_id": str(job.get("target_session_id") or ""),
    }

    print(f"Starting tracked agent run {message_id} for {target_profile}", flush=True)
    try:
        # The request is sent over stdin and never appears in the process argv.
        completed = subprocess.run(  # nosec B603
            command,
            input=json.dumps(target_payload),
            text=True,
            stdout=sys.stdout,
            stderr=sys.stderr,
            cwd=str(job["target_home"]),
            env=_target_environment(job),
            check=False,
        )
    except Exception as exc:
        response = f"Target run failed to start: {type(exc).__name__}: {exc}"
        returncode = 1
    else:
        returncode = int(completed.returncode)
        if returncode == 0:
            response = (
                "Target run exited without delivering an explicit "
                "agent_reply(kind='final'). Normal target output was not forwarded."
            )
        else:
            response = (
                f"Target run failed with exit code {returncode}. Normal target output was "
                "not forwarded; inspect the target profile's bounded private worker log."
            )

    try:
        appended = append_origin_reply(
            origin_profile=str(job["origin_profile"]),
            origin_session_id=str(job["origin_session_id"]),
            sender_profile=target_profile,
            message_id=message_id,
            conversation_id=conversation_id,
            kind="error",
            body=response,
        )
        print(json.dumps({"origin_append": appended}, sort_keys=True), flush=True)
    except Exception as exc:
        print(f"Origin append failed: {type(exc).__name__}: {exc}", flush=True)
        return 2

    fallback_appended = bool(appended.get("appended"))
    print(f"Completed tracked agent run {message_id} with exit {returncode}", flush=True)
    if returncode != 0:
        return 1
    return 1 if fallback_appended else 0


def main(argv: list[str] | None = None) -> int:
    arguments = argv if argv is not None else sys.argv[1:]
    if len(arguments) not in {1, 2}:
        print("Usage: worker.py JOB_JSON [DIAGNOSTIC_LOG]", file=sys.stderr)
        return 2
    job_path = Path(arguments[0])
    log_path = Path(arguments[1]) if len(arguments) == 2 else None
    exit_code = 2
    try:
        if log_path is not None:
            mark_log_active(log_path)
            _redirect_diagnostics(log_path)
        try:
            job = json.loads(job_path.read_text(encoding="utf-8"))
        finally:
            job_path.unlink(missing_ok=True)
        exit_code = run_job(job)
        return exit_code
    finally:
        _restore_diagnostics()
        if log_path is not None:
            try:
                finalize_log(log_path, exit_code)
            finally:
                unmark_log_active(log_path)
                prune_failure_logs(log_path.parent)


if __name__ == "__main__":
    raise SystemExit(main())
