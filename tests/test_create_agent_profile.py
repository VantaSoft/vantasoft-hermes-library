from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "create-agent-profile"
SKILL_MD = SKILL_DIR / "SKILL.md"
TEMPLATE = SKILL_DIR / "templates" / "bare-minimum-config.yaml"


def _frontmatter() -> dict:
    text = SKILL_MD.read_text(encoding="utf-8")
    _, raw, _ = text.split("---", 2)
    return yaml.safe_load(raw)


def test_create_agent_profile_is_a_flat_installable_skill():
    metadata = _frontmatter()

    assert SKILL_DIR.parent == ROOT / "skills"
    assert metadata["name"] == "create-agent-profile"
    assert metadata["version"] == "2.0.1"
    assert metadata["license"] == "MIT"
    assert metadata["metadata"]["hermes"]["category"] == "autonomous-ai-agents"
    assert metadata["metadata"]["hermes"]["renamed_from"] == ["new-agent-setup"]
    assert metadata["metadata"]["hermes"]["homepage"].endswith(
        "/skills/create-agent-profile"
    )
    assert TEMPLATE.is_file()


def test_create_agent_profile_intake_omits_integrations_question():
    text = SKILL_MD.read_text(encoding="utf-8")

    for field in ("**Name**", "**Title**", "**Responsibilities**"):
        assert field in text
    assert "• **Integrations**" not in text
    assert "Do not include an **Integrations** field in the initial intake" in text
    assert "Ask for any missing Name, Title, and Responsibilities" in text
    assert "Do not request a broad integrations inventory" in text


def test_bare_minimum_template_is_safe_and_renderable():
    text = TEMPLATE.read_text(encoding="utf-8")
    rendered = text.replace("<fleet-root>", "/srv/hermes/fleet").replace(
        "<profile-name>", "example"
    )
    config = yaml.safe_load(rendered)

    assert set(re.findall(r"<[^>]+>", text)) == {"<fleet-root>"}
    assert config["terminal"]["cwd"] == "/srv/hermes/fleet"
    assert config["agent"]["reasoning_effort"] == "xhigh"
    assert config["compression"]["threshold"] == 0.85
    assert config["display"]["tool_progress"] == "off"
    assert "mcp_servers" not in config
    assert "plugins" not in config
    assert "token" not in text.lower()
    assert "secret" not in text.lower()


def test_catalogs_publish_create_agent_profile_once():
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    components = {component["id"]: component for component in catalog["components"]}
    skills_manifest = json.loads((ROOT / "skills.sh.json").read_text(encoding="utf-8"))
    published = [
        skill
        for grouping in skills_manifest["groupings"]
        for skill in grouping["skills"]
    ]

    assert components["create-agent-profile"]["path"] == "skills/create-agent-profile"
    assert components["create-agent-profile"]["type"] == "hermes-skill"
    assert published.count("create-agent-profile") == 1
