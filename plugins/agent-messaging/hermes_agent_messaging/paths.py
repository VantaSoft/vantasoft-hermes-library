"""Hermes profile, installation path, and subprocess environment helpers."""

from __future__ import annotations

import os
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

_PROFILE_ENV_ALLOWLIST = frozenset(
    {
        "COLORTERM",
        "CURL_CA_BUNDLE",
        "HERMES_CODEX_AUTH_FILE",
        "HOME",
        "LANG",
        "LOGNAME",
        "NODE_EXTRA_CA_CERTS",
        "PATH",
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


def hermes_root() -> Path:
    """Return the default Hermes data root, even from a named profile."""

    try:
        from hermes_constants import get_default_hermes_root

        return Path(get_default_hermes_root())
    except Exception:
        configured = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        if configured.parent.name == "profiles":
            return configured.parent.parent
        return configured


def active_profile_name() -> str:
    try:
        from hermes_cli.profiles import get_active_profile_name

        return get_active_profile_name() or "default"
    except Exception:
        return os.environ.get("HERMES_PROFILE", "default")


def normalize_profile_name(raw: Any) -> str:
    try:
        from hermes_cli.profiles import normalize_profile_name as normalize

        return normalize(str(raw or ""))
    except Exception:
        return str(raw or "").strip().lower()


def profile_home(name: str) -> Path:
    from hermes_cli.profiles import get_profile_dir

    return Path(get_profile_dir(name))


def profile_exists(name: str) -> bool:
    from hermes_cli.profiles import profile_exists as exists

    return bool(exists(name))


def list_profiles() -> list[Any]:
    from hermes_cli.profiles import list_profiles as list_all

    return list(list_all())


def profile_subprocess_environment(
    *,
    root: str | Path | None = None,
    source: Mapping[str, str] | None = None,
    extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Build a narrow environment and let the selected profile load its own .env."""

    ambient = source if source is not None else os.environ
    environment = {
        key: str(value)
        for key, value in ambient.items()
        if key in _PROFILE_ENV_ALLOWLIST or key.startswith("LC_")
    }
    environment["HERMES_HOME"] = str(root or hermes_root())
    environment["PYTHONUNBUFFERED"] = "1"
    if extra:
        environment.update({key: str(value) for key, value in extra.items()})
    return environment


def hermes_executable() -> str:
    """Resolve the Hermes launcher for argv-only subprocess calls."""

    executable = shutil.which("hermes")
    if not executable:
        raise FileNotFoundError("The hermes executable is not available on PATH")
    return executable
