from __future__ import annotations

import pytest
from vantasoft_hermes_plugin import target_runner


def test_build_argv_keeps_prompt_in_memory_and_supports_resume():
    arguments = target_runner.build_hermes_argv(
        {
            "target_profile": "research",
            "prompt": "Private peer request",
            "source": "agent-message:default:conversation",
            "target_session_id": "target-session",
        }
    )

    assert arguments[:5] == ["hermes", "--profile", "research", "chat", "-q"]
    assert arguments[5] == "Private peer request"
    assert arguments[-2:] == ["--resume", "target-session"]


def test_build_argv_rejects_invalid_profile():
    with pytest.raises(ValueError, match="Invalid target profile"):
        target_runner.build_hermes_argv(
            {
                "target_profile": "../../other",
                "prompt": "Request",
                "source": "agent-message:default:conversation",
            }
        )


def test_build_argv_rejects_oversized_prompt():
    with pytest.raises(ValueError, match="prompt length"):
        target_runner.build_hermes_argv(
            {
                "target_profile": "research",
                "prompt": "x" * (target_runner._MAX_PROMPT_CHARS + 1),
                "source": "agent-message:default:conversation",
            }
        )
