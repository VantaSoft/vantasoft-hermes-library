"""Hermes runtime compatibility checks."""

from __future__ import annotations

import os
from pathlib import Path


class IncompatibleHermesError(RuntimeError):
    """Raised when the host lacks APIs required by the plugin."""


def ensure_compatible_runtime() -> None:
    """Fail clearly instead of partially registering unsafe messaging tools."""

    missing: list[str] = []
    try:
        from gateway.session_context import async_delivery_supported, get_session_env

        if not callable(async_delivery_supported):
            missing.append("gateway.session_context.async_delivery_supported")
        if not callable(get_session_env):
            missing.append("gateway.session_context.get_session_env")
    except Exception:
        missing.append("gateway.session_context")

    try:
        from tools.process_registry import process_registry

        if not callable(getattr(process_registry, "spawn_local", None)):
            missing.append("ProcessRegistry.spawn_local")
        if not hasattr(process_registry, "pending_watchers"):
            missing.append("ProcessRegistry.pending_watchers")
        if not callable(getattr(process_registry, "_write_checkpoint", None)):
            missing.append("ProcessRegistry._write_checkpoint")
    except Exception:
        missing.append("tools.process_registry")

    try:
        from hermes_state import SessionDB

        if SessionDB is None:
            missing.append("hermes_state.SessionDB")
    except Exception:
        missing.append("hermes_state.SessionDB")

    configured_auth_file = os.environ.get("HERMES_CODEX_AUTH_FILE")
    if configured_auth_file is not None:
        try:
            from hermes_constants import get_codex_auth_file_path

            if not callable(get_codex_auth_file_path):
                raise TypeError("get_codex_auth_file_path is not callable")
            if get_codex_auth_file_path() != Path(configured_auth_file):
                raise RuntimeError("runtime ignored HERMES_CODEX_AUTH_FILE")
        except Exception:
            missing.append("canonical HERMES_CODEX_AUTH_FILE support")

    if missing:
        details = ", ".join(sorted(set(missing)))
        raise IncompatibleHermesError(
            "vantasoft-agents requires its tested Hermes Agent 0.18.0 runtime APIs; "
            "missing: " + details
        )
