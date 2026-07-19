#!/usr/bin/env python3
"""Render and validate the canonical VantaSoft named-agent Slack manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

TEMPLATE_PATH = Path(__file__).with_name("template.json")

STANDARD_BOT_SCOPES = [
    "app_mentions:read",
    "chat:write",
    "reactions:read",
    "reactions:write",
    "files:read",
    "files:write",
    "users:read",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
    "im:write",
    "channels:read",
    "groups:read",
    "im:read",
    "mpim:read",
]

STANDARD_BOT_EVENTS = [
    "app_mention",
    "message.channels",
    "message.groups",
    "message.im",
    "message.mpim",
]

FORBIDDEN_FEATURES = {"slash_commands", "assistant_view", "agent_view"}
FORBIDDEN_SCOPES = {"commands", "assistant:write"}
FORBIDDEN_EVENTS = {"app_context_changed", "app_home_opened"}


def _replace(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: _replace(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace(item, replacements) for item in value]
    if isinstance(value, str):
        return replacements.get(value, value)
    return value


def build_manifest(name: str, description: str, background_color: str) -> dict[str, Any]:
    name = name.strip()
    description = description.strip()
    background_color = background_color.strip().lower()
    if not name:
        raise ValueError("Slack app name cannot be empty")
    if not description:
        raise ValueError("Slack app description cannot be empty")
    if not re.fullmatch(r"#[0-9a-f]{6}", background_color):
        raise ValueError("Background color must be a six-digit hex value such as #1a1a2e")

    template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    manifest = _replace(
        template,
        {
            "<Agent Name>": name,
            "<Short Description>": description,
            "<Hex Color>": background_color,
        },
    )
    validate_manifest(manifest)
    return manifest


def validate_manifest(manifest: dict[str, Any]) -> None:
    errors: list[str] = []
    metadata = manifest.get("_metadata") or {}
    display = manifest.get("display_information") or {}
    features = manifest.get("features") or {}
    settings = manifest.get("settings") or {}
    scopes = (manifest.get("oauth_config") or {}).get("scopes", {}).get("bot", [])
    events = (settings.get("event_subscriptions") or {}).get("bot_events", [])

    if metadata != {"major_version": 1, "minor_version": 1}:
        errors.append("metadata must be manifest version 1.1")
    if not display.get("name") or not display.get("description"):
        errors.append("display name and description are required")
    if (features.get("bot_user") or {}).get("display_name") != display.get("name"):
        errors.append("bot display name must match app display name")
    if FORBIDDEN_FEATURES.intersection(features):
        errors.append("slash commands and assistant/agent views must be absent")
    if scopes != STANDARD_BOT_SCOPES:
        errors.append("bot scopes do not match the canonical ordered scope set")
    if FORBIDDEN_SCOPES.intersection(scopes):
        errors.append("commands and assistant scopes must be absent")
    if events != STANDARD_BOT_EVENTS:
        errors.append("bot events do not match the canonical ordered event set")
    if FORBIDDEN_EVENTS.intersection(events):
        errors.append("assistant and app-home events must be absent")
    if "token_rotation_enabled" in settings:
        errors.append("token_rotation_enabled must be absent")
    if settings.get("socket_mode_enabled") is not True:
        errors.append("socket_mode_enabled must be true")
    if (settings.get("interactivity") or {}).get("is_enabled") is not True:
        errors.append("interactivity must be enabled")

    if errors:
        raise ValueError("Invalid Slack manifest: " + "; ".join(errors))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True, help="Visible Slack app and bot name")
    parser.add_argument("--description", required=True, help="Short visible Slack app description")
    parser.add_argument(
        "--background-color",
        default="#1a1a2e",
        help="Six-digit hex color; defaults to #1a1a2e",
    )
    parser.add_argument("--write", type=Path, help="Write JSON to this path instead of stdout")
    args = parser.parse_args(argv)

    try:
        manifest = build_manifest(args.name, args.description, args.background_color)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    payload = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        args.write.parent.mkdir(parents=True, exist_ok=True)
        args.write.write_text(payload, encoding="utf-8")
        print(args.write, file=sys.stderr)
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
