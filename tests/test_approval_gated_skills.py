from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS = {
    "approval-gated-email": ROOT / "skills" / "approval-gated-email" / "SKILL.md",
    "approval-gated-calendar": ROOT / "skills" / "approval-gated-calendar" / "SKILL.md",
}


def _read_skill(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    _, frontmatter, body = text.split("---", 2)
    return yaml.safe_load(frontmatter), body


def test_approval_gated_skills_are_installable_and_generic():
    prohibited_fleet_terms = (
        "forrest",
        "vantasoft",
        "telvana",
        "butterfli",
        "/users/vantasoft",
        "task manager",
    )

    for name, path in SKILLS.items():
        metadata, body = _read_skill(path)
        complete_text = path.read_text(encoding="utf-8").lower()

        assert metadata["name"] == name
        assert metadata["version"] == "1.0.0"
        assert metadata["license"] == "MIT"
        assert 1 <= len(metadata["description"]) <= 1024
        assert metadata["metadata"]["hermes"]["category"] in {"email", "productivity"}
        assert len(body.splitlines()) < 500
        assert all(term not in complete_text for term in prohibited_fleet_terms)


def test_email_skill_preserves_approval_and_threading_contract():
    _, body = _read_skill(SKILLS["approval-gated-email"])

    assert "gmail_read" in body
    assert "gmail_reply" in body
    assert "gmail_send" in body
    assert "gmail_forward" in body
    assert "messageId" in body
    assert "threadId" in body
    assert "replyAll=true" in body
    assert "obtain approval again" in body
    assert (
        ROOT
        / "skills"
        / "approval-gated-email"
        / "references"
        / "gmail-threading-and-approval.md"
    ).is_file()


def test_calendar_skill_preserves_approval_and_scheduling_contract():
    _, body = _read_skill(SKILLS["approval-gated-calendar"])

    assert "gcal_free_busy" in body
    assert "gcal_list_events" in body
    assert "gcal_create_event" in body
    assert "gcal_update_event" in body
    assert "gcal_delete_event" in body
    assert 'sendUpdates="all"' in body
    assert "IANA timezone" in body
    assert "requires a new proposal" in body


def test_catalogs_publish_both_skills_once():
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    components = {component["id"]: component for component in catalog["components"]}
    skills_manifest = json.loads((ROOT / "skills.sh.json").read_text(encoding="utf-8"))
    published = [
        skill
        for grouping in skills_manifest["groupings"]
        for skill in grouping["skills"]
    ]

    for name in SKILLS:
        assert components[name]["path"] == f"skills/{name}"
        assert components[name]["type"] == "hermes-skill"
        assert components[name]["companionComponent"] == "google-workspace"
        assert published.count(name) == 1
