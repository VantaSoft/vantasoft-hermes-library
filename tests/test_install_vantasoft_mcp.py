from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "install-vantasoft-mcp"
INSTALLER = SKILL_DIR / "scripts" / "install_mcp.py"
SKILL_MD = SKILL_DIR / "SKILL.md"


def _load_installer():
    spec = importlib.util.spec_from_file_location("install_vantasoft_mcp", INSTALLER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_fake_library(root: Path, *, failing: bool = False) -> None:
    component = root / "mcps" / "demo-mcp"
    component.mkdir(parents=True, exist_ok=True)
    (root / "catalog.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "components": [
                    {
                        "id": "demo-mcp",
                        "name": "Demo MCP",
                        "type": "mcp",
                        "path": "mcps/demo-mcp",
                        "installManifest": "mcps/demo-mcp/mcp-install.json",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (component / ".env.example").write_text("DEMO_TOKEN=\n", encoding="utf-8")
    (component / ".env").write_text("SHOULD_NOT_COPY=secret\n", encoding="utf-8")
    (component / ".env.local").write_text("SHOULD_NOT_COPY=secret\n", encoding="utf-8")
    command = (
        [sys.executable, "-c", "import sys; sys.exit(17)"]
        if failing
        else [
            sys.executable,
            "-c",
            "from pathlib import Path; "
            "Path('dist').mkdir(); Path('dist/server.py').write_text('ready\\n')",
        ]
    )
    (component / "mcp-install.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "componentId": "demo-mcp",
                "displayName": "Demo MCP",
                "runtime": {
                    "command": sys.executable,
                    "minimumVersion": f"{sys.version_info.major}.{sys.version_info.minor}.0",
                    "versionArgs": ["--version"],
                },
                "install": {
                    "bootstrap": [command],
                    "requiredFiles": ["dist/server.py"],
                },
                "transport": {
                    "serverName": "demo_mcp",
                    "command": "${INSTALL_DIR}/dist/server.py",
                    "args": [],
                    "env": {"DEMO_MODE": "safe"},
                    "timeout": 45,
                    "connectTimeout": 12,
                },
                "credentials": {
                    "directory": "mcp-tokens/demo-mcp",
                    "template": ".env.example",
                    "target": "mcp-tokens/demo-mcp/.env",
                },
                "nextSteps": [
                    "Edit ${CREDENTIAL_FILE} locally.",
                    "Reload the MCP for ${HERMES_HOME} from ${INSTALL_DIR}.",
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def test_skill_is_installable_and_points_to_bundled_installer():
    text = SKILL_MD.read_text(encoding="utf-8")
    _, frontmatter, body = text.split("---", 2)
    metadata = yaml.safe_load(frontmatter)

    assert metadata["name"] == "install-vantasoft-mcp"
    assert metadata["version"] == "1.0.0"
    assert metadata["metadata"]["hermes"]["category"] == "integrations"
    assert "scripts/install_mcp.py" in body
    assert "skills/install-vantasoft-mcp/scripts/install_mcp.py" in body
    assert "skills/integrations/install-vantasoft-mcp" not in body
    assert "Never ask the user to paste OAuth client secrets" in body
    assert INSTALLER.is_file()


def test_current_mcp_manifests_are_catalogued_and_safe():
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    mcp_entries = [entry for entry in catalog["components"] if entry["type"] == "mcp"]
    installer = _load_installer()

    assert {entry["id"] for entry in mcp_entries} >= {
        "google-workspace",
        "quickbooks-online",
    }
    for entry in mcp_entries:
        manifest_path = ROOT / entry["path"] / "mcp-install.json"
        assert manifest_path.is_file(), f"missing install manifest for {entry['id']}"
        installer._validate_manifest(manifest_path, entry["id"])

    qbo = json.loads(
        (ROOT / "mcps" / "quickbooks-online" / "mcp-install.json").read_text(
            encoding="utf-8"
        )
    )
    assert qbo["safeDefault"] == "read-only"
    assert qbo["transport"]["env"]["QUICKBOOKS_ENABLE_MUTATIONS"] == "false"
    assert ["npm", "run", "test:smoke"] in qbo["install"]["bootstrap"]


def test_dry_run_does_not_modify_target_profile(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    _write_fake_library(source)

    result = installer.install(
        "demo-mcp",
        hermes_home=home,
        ref="main",
        source_root=source,
        dry_run=True,
    )

    assert result["status"] == "planned"
    assert result["serverName"] == "demo_mcp"
    assert result["source"]["componentPath"] == "mcps/demo-mcp"
    assert result["existingInstall"] is False
    assert result["existingConfig"] is False
    assert not home.exists()


def test_existing_server_config_requires_force_before_install(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    home.mkdir()
    _write_fake_library(source)
    original = {
        "mcp_servers": {
            "demo_mcp": {
                "command": "external-demo",
                "args": ["--serve"],
            }
        }
    }
    config_path = home / "config.yaml"
    config_path.write_text(yaml.safe_dump(original, sort_keys=False), encoding="utf-8")

    with pytest.raises(installer.InstallerError, match="config.yaml:mcp_servers.demo_mcp"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
        )

    assert yaml.safe_load(config_path.read_text(encoding="utf-8")) == original
    assert not (home / "mcp-installs" / "demo-mcp").exists()


def test_install_builds_component_writes_config_and_preserves_credentials(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    home.mkdir()
    (home / "config.yaml").write_text("model:\n  default: test-model\n", encoding="utf-8")
    _write_fake_library(source)

    result = installer.install(
        "demo-mcp",
        hermes_home=home,
        ref="main",
        source_root=source,
    )

    install_dir = home / "mcp-installs" / "demo-mcp"
    credential = home / "mcp-tokens" / "demo-mcp" / ".env"
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    server = config["mcp_servers"]["demo_mcp"]

    assert result["status"] == "installed"
    assert (install_dir / "dist" / "server.py").read_text(encoding="utf-8") == "ready\n"
    assert not (install_dir / ".env").exists()
    assert not (install_dir / ".env.local").exists()
    assert credential.read_text(encoding="utf-8") == "DEMO_TOKEN=\n"
    assert config["model"]["default"] == "test-model"
    assert server == {
        "command": str(install_dir / "dist" / "server.py"),
        "args": [],
        "env": {"DEMO_MODE": "safe"},
        "timeout": 45,
        "connect_timeout": 12,
    }
    metadata = json.loads(
        (install_dir / ".vantasoft-mcp-install.json").read_text(encoding="utf-8")
    )
    assert metadata["componentId"] == "demo-mcp"
    assert metadata["componentPath"] == "mcps/demo-mcp"
    assert str(credential) in result["nextSteps"][0]

    credential.write_text("DEMO_TOKEN=existing\n", encoding="utf-8")
    config["mcp_servers"]["demo_mcp"]["tools"] = {"include": ["safe_read"]}
    (home / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

    with pytest.raises(installer.InstallerError, match="already has profile state"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
        )

    installer.install(
        "demo-mcp",
        hermes_home=home,
        ref="main",
        source_root=source,
        force=True,
    )
    reloaded = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert reloaded["mcp_servers"]["demo_mcp"]["tools"] == {"include": ["safe_read"]}
    assert credential.read_text(encoding="utf-8") == "DEMO_TOKEN=existing\n"


def test_failed_force_reinstall_rolls_back_install_and_config(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    _write_fake_library(source)
    installer.install(
        "demo-mcp",
        hermes_home=home,
        ref="main",
        source_root=source,
    )

    install_dir = home / "mcp-installs" / "demo-mcp"
    original_config = (home / "config.yaml").read_bytes()
    original_server = (install_dir / "dist" / "server.py").read_bytes()
    _write_fake_library(source, failing=True)

    with pytest.raises(installer.InstallerError, match="exit code 17"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
            force=True,
        )

    assert (home / "config.yaml").read_bytes() == original_config
    assert (install_dir / "dist" / "server.py").read_bytes() == original_server


def test_late_failure_restores_previous_install_and_config(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    _write_fake_library(source)
    installer.install(
        "demo-mcp",
        hermes_home=home,
        ref="main",
        source_root=source,
    )

    install_dir = home / "mcp-installs" / "demo-mcp"
    config_path = home / "config.yaml"
    credential = home / "mcp-tokens" / "demo-mcp" / ".env"
    original_config = config_path.read_bytes()
    original_server = (install_dir / "dist" / "server.py").read_bytes()
    original_credential = credential.read_bytes()

    manifest_path = source / "mcps" / "demo-mcp" / "mcp-install.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    del manifest["credentials"]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(installer.InstallerError, match="CREDENTIAL_FILE"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
            force=True,
        )

    assert config_path.read_bytes() == original_config
    assert (install_dir / "dist" / "server.py").read_bytes() == original_server
    assert credential.read_bytes() == original_credential


def test_install_rejects_component_symlinks(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    _write_fake_library(source)
    outside = tmp_path / "outside.txt"
    outside.write_text("outside\n", encoding="utf-8")
    (source / "mcps" / "demo-mcp" / "linked-secret").symlink_to(outside)

    with pytest.raises(installer.InstallerError, match="contains a symlink"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
        )

    assert not (home / "mcp-installs" / "demo-mcp").exists()


def test_credential_target_must_stay_in_declared_directory(tmp_path: Path):
    installer = _load_installer()
    source = tmp_path / "source"
    home = tmp_path / "profile"
    _write_fake_library(source)
    manifest_path = source / "mcps" / "demo-mcp" / "mcp-install.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["credentials"]["target"] = "config.yaml"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(installer.InstallerError, match="credentials.target escapes"):
        installer.install(
            "demo-mcp",
            hermes_home=home,
            ref="main",
            source_root=source,
            dry_run=True,
        )

    assert not home.exists()


def test_manifest_rejects_path_traversal(tmp_path: Path):
    installer = _load_installer()
    manifest = tmp_path / "mcp-install.json"
    manifest.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "componentId": "bad-mcp",
                "displayName": "Bad MCP",
                "runtime": {
                    "command": "python3",
                    "minimumVersion": "3.11",
                    "versionArgs": ["--version"],
                },
                "install": {
                    "bootstrap": [["python3", "-V"]],
                    "requiredFiles": ["../outside"],
                },
                "transport": {
                    "serverName": "bad_mcp",
                    "command": "python3",
                    "args": [],
                },
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(installer.InstallerError, match="stay inside"):
        installer._validate_manifest(manifest, "bad-mcp")
