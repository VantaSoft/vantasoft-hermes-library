from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from vantasoft_hermes_plugin import native_child


class FakeRegistry:
    def __init__(self):
        self.spawn_calls = []
        self.pending_watchers = []
        self.checkpoints = 0
        self.session = SimpleNamespace(
            id="proc-child",
            pid=4242,
            notify_on_complete=False,
            watcher_platform="",
            watcher_chat_id="",
            watcher_thread_id="",
            watcher_user_id="",
            watcher_user_name="",
            watcher_message_id="",
            watcher_interval=0,
        )

    def spawn_local(self, **kwargs):
        self.spawn_calls.append(kwargs)
        return self.session

    def _write_checkpoint(self):
        self.checkpoints += 1


def _job(tmp_path: Path) -> dict:
    target_home = tmp_path / "profiles" / "research"
    target_home.mkdir(parents=True)
    return {
        "message_id": "msg_" + "a" * 32,
        "conversation_id": "msg_" + "a" * 32,
        "sender_profile": "default",
        "target_profile": "research",
        "origin_profile": "default",
        "origin_session_id": "origin-session",
        "target_home": str(target_home),
        "hermes_root": str(tmp_path),
        "prompt": "SECRET REQUEST BODY",
        "source": "agent-message:default:conversation",
        "target_session_id": None,
    }


def _route() -> dict[str, str]:
    return {
        "session_key": "slack:C1:thread:1",
        "platform": "slack",
        "chat_id": "C1",
        "thread_id": "1",
        "user_id": "U1",
        "user_name": "User",
        "message_id": "1",
    }


def test_spawn_uses_native_registry_and_private_job(monkeypatch, tmp_path):
    monkeypatch.setattr(native_child.shutil, "which", lambda name: "/usr/bin/env")
    monkeypatch.setenv("HERMES_CODEX_AUTH_FILE", "/srv/customer/codex-auth.json")
    registry = FakeRegistry()
    job = _job(tmp_path)

    result = native_child.spawn_profile_child(job, route=_route(), registry=registry)

    assert result["tracked"] is True
    assert result["notify_on_complete"] is True
    assert registry.checkpoints == 1
    spawn = registry.spawn_calls[0]
    assert spawn["env_vars"]["HERMES_HOME"] == str(tmp_path)
    assert spawn["use_pty"] is False
    command = spawn["command"]
    assert "HERMES_CODEX_AUTH_FILE=/srv/customer/codex-auth.json" in command
    assert " -i " in command
    assert " -I " in command
    assert job["prompt"] not in command

    job_path = Path(result["job_path"])
    assert json.loads(job_path.read_text())["prompt"] == job["prompt"]
    assert job_path.stat().st_mode & 0o777 == 0o600
    assert registry.pending_watchers[0]["platform"] == "slack"


def test_cli_route_uses_completion_queue_without_gateway_watcher(tmp_path):
    registry = FakeRegistry()
    route = {key: "" for key in native_child._REQUIRED_ROUTE_KEYS}
    route["session_key"] = "cli-session"

    native_child.spawn_profile_child(_job(tmp_path), route=route, registry=registry)

    assert registry.session.notify_on_complete is True
    assert registry.pending_watchers == []
    assert registry.checkpoints == 1


def test_spawn_fails_closed_without_env_executable(monkeypatch, tmp_path):
    monkeypatch.setattr(native_child.shutil, "which", lambda name: None)
    registry = FakeRegistry()
    job = _job(tmp_path)

    try:
        native_child.spawn_profile_child(job, route=_route(), registry=registry)
    except RuntimeError as exc:
        assert "env executable" in str(exc)
    else:
        raise AssertionError("Expected secure bootstrap failure")

    assert registry.spawn_calls == []
    runtime_dir = Path(job["target_home"]) / "tmp" / "vantasoft-agent-messages"
    assert not (runtime_dir / f"{job['message_id']}.json").exists()


def test_incomplete_route_is_rejected(tmp_path):
    registry = FakeRegistry()
    job = _job(tmp_path)

    try:
        native_child.spawn_profile_child(
            job,
            route={"session_key": "missing-fields"},
            registry=registry,
        )
    except ValueError as exc:
        assert "Incomplete origin route" in str(exc)
    else:
        raise AssertionError("Expected incomplete route to fail")

    assert registry.checkpoints == 0
    runtime_dir = Path(job["target_home"]) / "tmp" / "vantasoft-agent-messages"
    assert not (runtime_dir / f"{job['message_id']}.json").exists()
