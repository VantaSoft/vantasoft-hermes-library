from __future__ import annotations

from types import SimpleNamespace

from vantasoft_hermes_plugin import schemas, tools


def test_list_agents_returns_profile_metadata(monkeypatch):
    profiles = [
        SimpleNamespace(
            name="default",
            is_default=True,
            gateway_running=False,
            model="model-a",
            provider="provider-a",
            description="Default profile",
        ),
        SimpleNamespace(
            name="research",
            is_default=False,
            gateway_running=True,
            model="model-b",
            provider="provider-b",
            description="Research agent",
        ),
    ]
    monkeypatch.setattr(tools, "list_profiles", lambda: profiles)
    monkeypatch.setattr(tools, "active_profile_name", lambda: "default")

    import json

    payload = json.loads(tools.handle_list_agents({}))

    assert payload["success"] is True
    assert payload["count"] == 2
    assert payload["agents"][1]["name"] == "research"
    assert payload["agents"][1]["gateway_running"] is True


def test_message_schema_is_async_only():
    properties = schemas.MESSAGE_AGENT["parameters"]["properties"]

    assert set(properties) == {"agent", "message", "reply_to"}
    description = schemas.MESSAGE_AGENT["description"].lower()
    assert "poll" in description
    assert "bounded peer work" in description
    assert "durable task board" in description
    assert "secret values" in description
    assert properties["message"]["maxLength"] == schemas.MAX_MESSAGE_CHARS


def test_agent_reply_schema_requires_concrete_secret_free_results():
    description = schemas.AGENT_REPLY["description"].lower()

    assert "concrete result or precise blocker" in description
    assert "secret values" in description
    assert "conversational filler" in description


def test_message_agent_rejects_oversized_request():
    import json

    payload = json.loads(
        tools.handle_message_agent(
            {"agent": "research", "message": "x" * (schemas.MAX_MESSAGE_CHARS + 1)}
        )
    )

    assert payload["success"] is False
    assert "character limit" in payload["error"]


def test_message_agent_starts_private_tracked_child(monkeypatch, tmp_path):
    import json

    target_home = tmp_path / "profiles" / "research"
    target_home.mkdir(parents=True)
    jobs = []

    monkeypatch.setattr(tools, "active_profile_name", lambda: "default")
    monkeypatch.setattr(tools, "profile_exists", lambda name: name == "research")
    monkeypatch.setattr(tools, "profile_home", lambda name: target_home)
    monkeypatch.setattr(tools, "hermes_root", lambda: tmp_path)
    monkeypatch.setattr(
        tools.origin_reply,
        "resolve_origin_session",
        lambda profile, session_id: session_id,
    )
    monkeypatch.setattr(
        tools.native_child,
        "current_origin_route",
        lambda **kwargs: {
            "session_key": "slack:C1:thread:1",
            "platform": "slack",
            "chat_id": "C1",
            "thread_id": "1",
            "user_id": "U1",
            "user_name": "User",
            "message_id": "1",
        },
    )
    monkeypatch.setattr(
        tools.native_child,
        "spawn_profile_child",
        lambda job, **kwargs: jobs.append((job, kwargs))
        or {"tracked": True, "notify_on_complete": True, "pid": 42},
    )

    payload = json.loads(
        tools.handle_message_agent(
            {"agent": "research", "message": "Investigate this."},
            session_id="origin-session",
        )
    )

    assert payload["success"] is True
    assert payload["delivery"] == "tracked_profile_child"
    assert payload["tracked"] is True
    assert "pid" not in payload
    assert len(jobs) == 1
    job, spawn_kwargs = jobs[0]
    assert job["hermes_root"] == str(tmp_path)
    assert job["target_profile"] == "research"
    assert "kind='final'" in job["prompt"]
    assert "route" in spawn_kwargs


def test_message_agent_rejects_self_message(monkeypatch):
    import json

    monkeypatch.setattr(tools, "active_profile_name", lambda: "research")
    monkeypatch.setattr(tools, "profile_exists", lambda name: True)

    payload = json.loads(
        tools.handle_message_agent({"agent": "research", "message": "Loop."})
    )

    assert payload["success"] is False
    assert "active profile" in payload["error"]


def test_agent_reply_appends_to_origin_session(monkeypatch):
    import json

    message_id = "msg_" + "a" * 32
    appended = []
    monkeypatch.setattr(tools, "active_profile_name", lambda: "research")
    monkeypatch.setattr(
        tools.origin_reply,
        "reply_context_from_env",
        lambda: {
            "message_id": message_id,
            "conversation_id": message_id,
            "origin_profile": "default",
            "origin_session_id": "origin-session",
            "sender_profile": "research",
            "request_sender_profile": "default",
        },
    )
    monkeypatch.setattr(
        tools.origin_reply,
        "append_origin_reply",
        lambda **kwargs: appended.append(kwargs)
        or {
            "appended": True,
            "deduplicated": False,
            "origin_profile": "default",
            "origin_session_id": "origin-session",
            "platform_message_id": "agent-reply:test",
        },
    )

    payload = json.loads(
        tools.handle_agent_reply(
            {"message_id": message_id, "kind": "final", "message": "Complete."}
        )
    )

    assert payload["success"] is True
    assert payload["kind"] == "final"
    assert appended[0]["sender_profile"] == "research"
    assert appended[0]["body"] == "Complete."
