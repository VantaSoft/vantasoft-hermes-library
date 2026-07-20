from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "new-agent-setup"
SKILL_MD = SKILL_DIR / "SKILL.md"
TEMPLATE = SKILL_DIR / "templates" / "bare-minimum-config.yaml"


def _frontmatter() -> dict:
    text = SKILL_MD.read_text(encoding="utf-8")
    _, raw, _ = text.split("---", 2)
    return yaml.safe_load(raw)


def test_new_agent_setup_is_a_flat_installable_skill():
    metadata = _frontmatter()

    assert SKILL_DIR.parent == ROOT / "skills"
    assert metadata["name"] == "new-agent-setup"
    assert metadata["version"] == "1.9.0"
    assert metadata["license"] == "MIT"
    assert metadata["metadata"]["hermes"]["category"] == "autonomous-ai-agents"
    assert metadata["metadata"]["hermes"]["homepage"].endswith(
        "/skills/new-agent-setup"
    )
    assert TEMPLATE.is_file()


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


def test_catalogs_publish_new_agent_setup_once():
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    components = {component["id"]: component for component in catalog["components"]}
    skills_manifest = json.loads((ROOT / "skills.sh.json").read_text(encoding="utf-8"))
    published = [
        skill
        for grouping in skills_manifest["groupings"]
        for skill in grouping["skills"]
    ]

    assert components["new-agent-setup"]["path"] == "skills/new-agent-setup"
    assert components["new-agent-setup"]["type"] == "hermes-skill"
    assert published.count("new-agent-setup") == 1
