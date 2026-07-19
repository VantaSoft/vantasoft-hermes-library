from __future__ import annotations

from pathlib import Path

import hermes_agent_messaging
import pytest
import yaml
from hermes_agent_messaging import compat

ROOT = Path(__file__).resolve().parents[3]
PLUGIN_ROOT = ROOT / "plugins" / "agent-messaging"


def test_manifest_and_package_versions_match():
    manifest = yaml.safe_load((PLUGIN_ROOT / "plugin.yaml").read_text())

    assert manifest["name"] == "agent-messaging"
    assert manifest["version"] == hermes_agent_messaging.__version__
    assert set(manifest["provides_tools"]) == {
        "list_agents",
        "agent_status",
        "message_agent",
        "agent_reply",
    }


def test_plugin_contains_no_internal_fleet_routes():
    forbidden = ("/Users/", "slack:#agent-comms", "hermes_gateway_restarts.py")
    package_root = PLUGIN_ROOT / "hermes_agent_messaging"

    for path in package_root.glob("*.py"):
        content = path.read_text()
        for value in forbidden:
            assert value not in content, f"{value!r} found in {path.name}"


def test_codex_auth_requires_runtime_that_honors_configured_path(
    monkeypatch, tmp_path
):
    import hermes_constants

    configured = tmp_path / "shared" / "codex-auth.json"
    monkeypatch.setenv("HERMES_CODEX_AUTH_FILE", str(configured))
    monkeypatch.setattr(
        hermes_constants,
        "get_codex_auth_file_path",
        lambda: tmp_path / "profile" / "auth.json",
    )

    with pytest.raises(
        compat.IncompatibleHermesError,
        match="canonical HERMES_CODEX_AUTH_FILE support",
    ):
        compat.ensure_compatible_runtime()

    monkeypatch.setattr(
        hermes_constants,
        "get_codex_auth_file_path",
        lambda: configured,
    )
    compat.ensure_compatible_runtime()


def test_legacy_auth_override_is_not_a_plugin_compatibility_alias(monkeypatch):
    import hermes_constants

    monkeypatch.delenv("HERMES_CODEX_AUTH_FILE", raising=False)
    monkeypatch.setenv("HERMES_AUTH_FILE", "/tmp/legacy-auth.json")
    monkeypatch.delattr(
        hermes_constants,
        "get_codex_auth_file_path",
        raising=False,
    )

    compat.ensure_compatible_runtime()
