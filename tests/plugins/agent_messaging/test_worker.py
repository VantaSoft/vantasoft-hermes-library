from __future__ import annotations

import json
import sys
from types import SimpleNamespace

from hermes_agent_messaging import worker


def _job(tmp_path):
    return {
        "message_id": "msg_" + "a" * 32,
        "conversation_id": "msg_" + "a" * 32,
        "sender_profile": "default",
        "target_profile": "research",
        "origin_profile": "default",
        "origin_session_id": "origin-session",
        "target_home": str(tmp_path),
        "hermes_root": str(tmp_path),
        "prompt": "Do the work.",
        "source": "agent-message:default:conversation",
        "target_session_id": None,
    }


def test_worker_sends_prompt_over_stdin_not_process_arguments(monkeypatch, tmp_path):
    calls = []
    appends = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(worker.subprocess, "run", fake_run)
    monkeypatch.setattr(
        worker,
        "append_origin_reply",
        lambda **kwargs: appends.append(kwargs)
        or {"success": True, "appended": False, "deduplicated": True},
    )

    result = worker.run_job(_job(tmp_path))

    assert result == 0
    command, call_kwargs = calls[0]
    assert command[0] == sys.executable
    assert command[1] == "-I"
    assert command[2].endswith("target_runner.py")
    assert "Do the work." not in command
    payload = json.loads(call_kwargs["input"])
    assert payload["prompt"] == "Do the work."
    assert call_kwargs["text"] is True
    assert appends[0]["kind"] == "error"
    assert "without delivering an explicit" in appends[0]["body"]


def test_target_environment_drops_unknown_sender_credentials(tmp_path):
    environment = worker._target_environment(
        _job(tmp_path),
        {
            "PATH": "/usr/bin",
            "HOME": "/home/hermes",
            "HERMES_CODEX_AUTH_FILE": "/srv/customer/codex-auth.json",
            "LC_ALL": "C.UTF-8",
            "CUSTOM_VENDOR_TOKEN": "sender-secret",
            "MCP_INTERNAL_API_KEY": "sender-secret",
            "OPENAI_API_KEY": "sender-secret",
        },
    )

    assert environment["PATH"] == "/usr/bin"
    assert environment["LC_ALL"] == "C.UTF-8"
    assert environment["HERMES_HOME"] == str(tmp_path)
    assert environment["HERMES_CODEX_AUTH_FILE"] == "/srv/customer/codex-auth.json"
    assert environment["HERMES_AGENT_TARGET_PROFILE"] == "research"
    assert "CUSTOM_VENDOR_TOKEN" not in environment
    assert "MCP_INTERNAL_API_KEY" not in environment
    assert "OPENAI_API_KEY" not in environment


def test_worker_bootstrap_environment_drops_unknown_sender_credentials():
    environment = worker._narrow_worker_environment(
        {
            "PATH": "/usr/bin",
            "HERMES_HOME": "/srv/hermes",
            "HERMES_CODEX_AUTH_FILE": "/srv/customer/codex-auth.json",
            "CUSTOM_VENDOR_TOKEN": "sender-secret",
        }
    )

    assert environment == {
        "PATH": "/usr/bin",
        "HERMES_HOME": "/srv/hermes",
        "HERMES_CODEX_AUTH_FILE": "/srv/customer/codex-auth.json",
    }


def test_worker_reports_missing_final(monkeypatch, tmp_path):
    monkeypatch.setattr(
        worker.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0),
    )
    monkeypatch.setattr(
        worker,
        "append_origin_reply",
        lambda **kwargs: {"success": True, "appended": True, "deduplicated": False},
    )

    assert worker.run_job(_job(tmp_path)) == 1


def test_worker_resumes_target_session_through_stdin(monkeypatch, tmp_path):
    calls = []
    job = _job(tmp_path)
    job["target_session_id"] = "target-session"

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(worker.subprocess, "run", fake_run)
    monkeypatch.setattr(
        worker,
        "append_origin_reply",
        lambda **kwargs: {"success": True, "appended": False, "deduplicated": True},
    )

    assert worker.run_job(job) == 0
    payload = json.loads(calls[0][1]["input"])
    assert payload["target_session_id"] == "target-session"
    assert "timeout" not in calls[0][1]
