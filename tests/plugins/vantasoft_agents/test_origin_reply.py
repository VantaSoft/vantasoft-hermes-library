from __future__ import annotations

from vantasoft_hermes_plugin import origin_reply


def _create_session(tmp_path, session_id="origin-session"):
    from hermes_state import SessionDB

    home = tmp_path / "profiles" / "default"
    home.mkdir(parents=True)
    database = SessionDB(db_path=home / "state.db")
    database.create_session(session_id, source="test")
    database.close()
    return home


def test_reply_appends_to_exact_session_and_deduplicates(monkeypatch, tmp_path):
    from hermes_state import SessionDB

    home = _create_session(tmp_path)
    monkeypatch.setattr(origin_reply, "profile_home", lambda profile: home)
    message_id = "msg_" + "a" * 32

    first = origin_reply.append_origin_reply(
        origin_profile="default",
        origin_session_id="origin-session",
        sender_profile="research",
        message_id=message_id,
        kind="ack",
        body="Received.",
    )
    duplicate = origin_reply.append_origin_reply(
        origin_profile="default",
        origin_session_id="origin-session",
        sender_profile="research",
        message_id=message_id,
        kind="ack",
        body="Received.",
    )

    assert first["appended"] is True
    assert duplicate["deduplicated"] is True

    database = SessionDB(db_path=home / "state.db", read_only=True)
    try:
        messages = database.get_messages("origin-session")
    finally:
        database.close()
    assert len(messages) == 1
    assert "Agent reply from research" in messages[0]["content"]
    assert messages[0]["observed"] == 0


def test_terminal_reply_closes_message(monkeypatch, tmp_path):
    from hermes_state import SessionDB

    home = _create_session(tmp_path)
    monkeypatch.setattr(origin_reply, "profile_home", lambda profile: home)
    message_id = "msg_" + "b" * 32

    final = origin_reply.append_origin_reply(
        origin_profile="default",
        origin_session_id="origin-session",
        sender_profile="research",
        message_id=message_id,
        kind="final",
        body="Complete.",
    )
    late_progress = origin_reply.append_origin_reply(
        origin_profile="default",
        origin_session_id="origin-session",
        sender_profile="research",
        message_id=message_id,
        kind="progress",
        body="Late update.",
    )

    assert final["appended"] is True
    assert late_progress["terminal_closed"] is True

    database = SessionDB(db_path=home / "state.db", read_only=True)
    try:
        messages = database.get_messages("origin-session")
    finally:
        database.close()
    assert len(messages) == 1
    assert "Complete." in messages[0]["content"]
    assert "Late update." not in messages[0]["content"]


def test_continuation_reply_names_conversation(monkeypatch, tmp_path):
    home = _create_session(tmp_path)
    monkeypatch.setattr(origin_reply, "profile_home", lambda profile: home)
    message_id = "msg_" + "c" * 32
    conversation_id = "msg_" + "d" * 32

    result = origin_reply.append_origin_reply(
        origin_profile="default",
        origin_session_id="origin-session",
        sender_profile="research",
        message_id=message_id,
        conversation_id=conversation_id,
        kind="final",
        body="Continuation complete.",
    )

    assert result["appended"] is True
    assert conversation_id in origin_reply.format_reply(
        "research",
        message_id,
        "final",
        "Continuation complete.",
        conversation_id=conversation_id,
    )
