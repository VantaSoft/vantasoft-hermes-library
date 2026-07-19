from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "slack-app-manifest"
SKILL_MD = SKILL_DIR / "SKILL.md"
GENERATOR = SKILL_DIR / "scripts" / "generate_slack_manifest.py"
TEMPLATE = SKILL_DIR / "templates" / "template.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("slack_manifest_generator", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_skill_is_installable_from_a_github_tap():
    text = SKILL_MD.read_text(encoding="utf-8")
    _, frontmatter, body = text.split("---", 2)
    metadata = yaml.safe_load(frontmatter)

    assert metadata["name"] == "slack-app-manifest"
    assert metadata["version"] == "1.0.0"
    assert metadata["metadata"]["hermes"]["category"] == "integrations"
    assert "scripts/generate_slack_manifest.py" in body
    assert "templates/template.json" in body
    assert (ROOT / "skills.sh.json").is_file()


def test_template_is_runtime_plugin_free_and_paste_safe():
    manifest = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    features = manifest["features"]
    scopes = manifest["oauth_config"]["scopes"]["bot"]
    events = manifest["settings"]["event_subscriptions"]["bot_events"]

    assert set(features) == {"app_home", "bot_user"}
    assert "slash_commands" not in features
    assert "assistant_view" not in features
    assert "agent_view" not in features
    assert "commands" not in scopes
    assert "assistant:write" not in scopes
    assert "files:read" in scopes
    assert "files:write" in scopes
    assert events == [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
    ]
    assert manifest["settings"]["socket_mode_enabled"] is True
    assert "token_rotation_enabled" not in manifest["settings"]


def test_generator_renders_and_validates_manifest():
    completed = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--name",
            "Markus",
            "--description",
            "Engineering agent",
            "--background-color",
            "#1a1a2e",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    manifest = json.loads(completed.stdout)

    assert manifest["display_information"] == {
        "name": "Markus",
        "description": "Engineering agent",
        "background_color": "#1a1a2e",
    }
    assert manifest["features"]["bot_user"]["display_name"] == "Markus"


def test_generator_rejects_invalid_values():
    generator = _load_generator()

    for kwargs in (
        {"name": "", "description": "Engineering", "background_color": "#1a1a2e"},
        {"name": "Markus", "description": "", "background_color": "#1a1a2e"},
        {"name": "Markus", "description": "Engineering", "background_color": "navy"},
    ):
        try:
            generator.build_manifest(**kwargs)
        except ValueError:
            continue
        raise AssertionError(f"Expected invalid manifest inputs to fail: {kwargs}")
