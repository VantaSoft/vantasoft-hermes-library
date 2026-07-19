"""In-process Hermes CLI launcher that receives the peer request over stdin."""

from __future__ import annotations

import json
import re
import sys
from typing import Any

_PROFILE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_MAX_PROMPT_CHARS = 131_072


def build_hermes_argv(payload: dict[str, Any]) -> list[str]:
    """Validate a worker payload and build an in-memory Hermes argv."""

    profile = str(payload.get("target_profile") or "").strip().lower()
    prompt = str(payload.get("prompt") or "")
    source = str(payload.get("source") or "").strip()
    target_session_id = str(payload.get("target_session_id") or "").strip()

    if not _PROFILE_PATTERN.fullmatch(profile):
        raise ValueError("Invalid target profile")
    if not prompt or len(prompt) > _MAX_PROMPT_CHARS:
        raise ValueError("Invalid target prompt length")
    if not source or len(source) > 512:
        raise ValueError("Invalid session source")
    if len(target_session_id) > 256:
        raise ValueError("Invalid target session ID")

    arguments = [
        "hermes",
        "--profile",
        profile,
        "chat",
        "-q",
        prompt,
        "--source",
        source,
        "-Q",
    ]
    if target_session_id:
        arguments.extend(["--resume", target_session_id])
    return arguments


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("Payload must be an object")
        sys.argv = build_hermes_argv(payload)
    except Exception as exc:
        print(f"Invalid peer-agent payload: {type(exc).__name__}", file=sys.stderr)
        return 2

    try:
        from hermes_cli.main import main as hermes_main

        result = hermes_main()
    except SystemExit as exc:
        return int(exc.code or 0) if isinstance(exc.code, int | type(None)) else 1
    return int(result or 0)


if __name__ == "__main__":
    raise SystemExit(main())
