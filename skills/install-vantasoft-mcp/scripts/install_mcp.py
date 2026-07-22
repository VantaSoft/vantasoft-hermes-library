#!/usr/bin/env python3
"""Install one MCP component from the VantaSoft Hermes Library.

The installer deliberately separates source distribution from credential setup:
it fetches one catalogued MCP subdirectory, validates its install manifest,
bootstraps it in a staging directory, atomically places it under the active
Hermes profile, and writes the MCP transport configuration. It never accepts or
writes credential values. Component manifests may create an empty credential
directory or copy a checked-in example file without overwriting existing state.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _ensure_hermes_python() -> None:
    """Re-exec with Hermes's Python when the ambient python lacks PyYAML.

    macOS ships an older ``/usr/bin/python3`` without Hermes dependencies. A
    skill invoked with plain ``python3`` should still find the interpreter next
    to the active ``hermes`` executable instead of asking the operator to know
    the deployment's virtualenv layout.
    """

    if sys.version_info >= (3, 9) and importlib.util.find_spec("yaml") is not None:
        return
    hermes = shutil.which("hermes")
    candidates: list[Path] = []
    if hermes:
        bin_dir = Path(hermes).resolve().parent
        candidates.extend(
            [bin_dir / "python3", bin_dir / "python", bin_dir / "python.exe"]
        )
    current = Path(sys.executable).resolve()
    for candidate in candidates:
        if (
            candidate.is_file()
            and os.access(candidate, os.X_OK)
            and candidate.resolve() != current
        ):
            os.execv(
                str(candidate),
                [str(candidate), str(Path(__file__).resolve()), *sys.argv[1:]],
            )
    raise SystemExit(
        "Python 3.9+ with PyYAML is required. Run this installer with the Python "
        "interpreter next to the active hermes executable."
    )


_ensure_hermes_python()

import yaml  # noqa: E402  (loaded after the interpreter compatibility check)

DEFAULT_REPOSITORY_URL = "https://github.com/VantaSoft/vantasoft-hermes-library.git"
MANIFEST_FILENAME = "mcp-install.json"
INSTALL_METADATA_FILENAME = ".vantasoft-mcp-install.json"
INSTALL_DIR_TOKEN = "${INSTALL_DIR}"
HERMES_HOME_TOKEN = "${HERMES_HOME}"
CREDENTIAL_FILE_TOKEN = "${CREDENTIAL_FILE}"
_COMPONENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_SERVER_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
_VERSION_RE = re.compile(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?")


class InstallerError(RuntimeError):
    """A user-actionable installation failure."""


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _run(
    command: list[str],
    *,
    cwd: Optional[Path] = None,
    capture: bool = False,
    timeout: int = 600,
) -> subprocess.CompletedProcess[str]:
    if not command or not all(isinstance(part, str) and part for part in command):
        raise InstallerError("Manifest command must be a non-empty list of strings.")
    _log(f"  $ {' '.join(command)}")
    try:
        return subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=True,
            capture_output=capture,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise InstallerError(f"Required command is not installed: {command[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise InstallerError(
            f"Command timed out after {timeout} seconds: {' '.join(command)}"
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip() if capture else ""
        suffix = f"\n{detail}" if detail else ""
        raise InstallerError(
            f"Command failed with exit code {exc.returncode}: {' '.join(command)}{suffix}"
        ) from exc


def _safe_relative_path(value: str, *, label: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise InstallerError(f"{label} must be a non-empty relative path.")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise InstallerError(f"{label} must stay inside its declared root: {value!r}")
    return path


def _require_within(root: Path, candidate: Path, *, label: str) -> None:
    root_resolved = root.resolve(strict=False)
    candidate_resolved = candidate.resolve(strict=False)
    if candidate_resolved != root_resolved and root_resolved not in candidate_resolved.parents:
        raise InstallerError(f"{label} escapes its declared root: {candidate}")


def _validate_ref(ref: str) -> str:
    if not _REF_RE.fullmatch(ref) or ".." in ref or "@{" in ref:
        raise InstallerError(f"Invalid Git ref: {ref!r}")
    return ref


def _load_json(path: Path, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise InstallerError(f"{label} not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise InstallerError(f"{label} is not valid JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise InstallerError(f"{label} must contain a JSON object: {path}")
    return value


def _catalog_component(repository_root: Path, component_id: str) -> tuple[dict[str, Any], Path]:
    catalog = _load_json(repository_root / "catalog.json", label="Library catalog")
    if catalog.get("schemaVersion") != 1:
        raise InstallerError("Unsupported library catalog schemaVersion.")
    components = catalog.get("components")
    if not isinstance(components, list):
        raise InstallerError("Library catalog components must be a list.")
    matches = [
        entry
        for entry in components
        if isinstance(entry, dict) and entry.get("id") == component_id
    ]
    if len(matches) != 1:
        raise InstallerError(f"MCP component is not uniquely catalogued: {component_id}")
    entry = matches[0]
    if entry.get("type") != "mcp":
        raise InstallerError(f"Catalog component is not an MCP: {component_id}")
    relative = _safe_relative_path(str(entry.get("path") or ""), label="Catalog component path")
    component_path = (repository_root / relative).resolve()
    repository_resolved = repository_root.resolve()
    if component_path != repository_resolved and repository_resolved not in component_path.parents:
        raise InstallerError("Catalog component path escapes the repository.")
    if not component_path.is_dir():
        raise InstallerError(f"Catalog component directory is missing: {relative}")
    expected_manifest = f"{relative.as_posix()}/{MANIFEST_FILENAME}"
    if entry.get("installManifest") != expected_manifest:
        raise InstallerError(
            f"Catalog installManifest must point to {expected_manifest}."
        )
    return entry, component_path


def _fetch_repository(component_id: str, ref: str, destination: Path) -> tuple[Path, str]:
    git = shutil.which("git")
    if not git:
        raise InstallerError("git is required but was not found on PATH.")
    component_path = f"mcps/{component_id}"
    destination.mkdir(parents=True, exist_ok=False)
    _run([git, "init", str(destination)], capture=True)
    _run([git, "-C", str(destination), "remote", "add", "origin", DEFAULT_REPOSITORY_URL])
    _run([git, "-C", str(destination), "sparse-checkout", "init", "--cone"])
    _run([git, "-C", str(destination), "sparse-checkout", "set", component_path])
    _run([git, "-C", str(destination), "fetch", "--depth", "1", "origin", ref], timeout=300)
    _run([git, "-C", str(destination), "checkout", "--detach", "FETCH_HEAD"], capture=True)
    completed = _run(
        [git, "-C", str(destination), "rev-parse", "HEAD"],
        capture=True,
    )
    return destination, completed.stdout.strip()


def _local_repository(source_root: Path) -> tuple[Path, str]:
    root = source_root.expanduser().resolve()
    if not root.is_dir():
        raise InstallerError(f"Local source root does not exist: {root}")
    git = shutil.which("git")
    if not git:
        return root, "local"
    try:
        completed = subprocess.run(
            [git, "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.SubprocessError, OSError):
        return root, "local"
    return root, completed.stdout.strip() or "local"


def _string_list(value: Any, *, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise InstallerError(f"{label} must be a list of non-empty strings.")
    return list(value)


def _command_list(value: Any, *, label: str) -> list[list[str]]:
    if not isinstance(value, list):
        raise InstallerError(f"{label} must be a list of argument arrays.")
    commands: list[list[str]] = []
    for index, command in enumerate(value):
        commands.append(_string_list(command, label=f"{label}[{index}]"))
    return commands


def _validate_manifest(path: Path, component_id: str) -> dict[str, Any]:
    manifest = _load_json(path, label="MCP install manifest")
    if manifest.get("schemaVersion") != 1:
        raise InstallerError("Unsupported MCP install manifest schemaVersion.")
    if manifest.get("componentId") != component_id:
        raise InstallerError(
            "MCP install manifest componentId does not match the requested component."
        )
    display_name = manifest.get("displayName")
    if not isinstance(display_name, str) or not display_name.strip():
        raise InstallerError("MCP install manifest requires displayName.")

    runtime = manifest.get("runtime")
    if not isinstance(runtime, dict):
        raise InstallerError("MCP install manifest requires a runtime object.")
    if not isinstance(runtime.get("command"), str) or not runtime["command"]:
        raise InstallerError("runtime.command must be a non-empty string.")
    _string_list(runtime.get("versionArgs", ["--version"]), label="runtime.versionArgs")
    if not isinstance(runtime.get("minimumVersion"), str) or not runtime["minimumVersion"]:
        raise InstallerError("runtime.minimumVersion must be a non-empty string.")

    install = manifest.get("install")
    if not isinstance(install, dict):
        raise InstallerError("MCP install manifest requires an install object.")
    _command_list(install.get("bootstrap"), label="install.bootstrap")
    for relative in _string_list(install.get("requiredFiles"), label="install.requiredFiles"):
        _safe_relative_path(relative, label="install.requiredFiles entry")

    transport = manifest.get("transport")
    if not isinstance(transport, dict):
        raise InstallerError("MCP install manifest requires a transport object.")
    server_name = transport.get("serverName")
    if not isinstance(server_name, str) or not _SERVER_RE.fullmatch(server_name):
        raise InstallerError("transport.serverName is invalid.")
    if not isinstance(transport.get("command"), str) or not transport["command"]:
        raise InstallerError("transport.command must be a non-empty string.")
    _string_list(transport.get("args", []), label="transport.args")
    env = transport.get("env", {})
    if not isinstance(env, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in env.items()
    ):
        raise InstallerError("transport.env must be a string-to-string object.")
    for key in ("timeout", "connectTimeout"):
        value = transport.get(key)
        if value is not None and (not isinstance(value, int) or value <= 0):
            raise InstallerError(f"transport.{key} must be a positive integer.")

    credentials = manifest.get("credentials")
    if credentials is not None:
        if not isinstance(credentials, dict):
            raise InstallerError("credentials must be an object.")
        _safe_relative_path(str(credentials.get("directory") or ""), label="credentials.directory")
        template = credentials.get("template")
        target = credentials.get("target")
        if bool(template) != bool(target):
            raise InstallerError(
                "credentials.template and credentials.target must be set together."
            )
        if template:
            _safe_relative_path(str(template), label="credentials.template")
            _safe_relative_path(str(target), label="credentials.target")

    next_steps = manifest.get("nextSteps", [])
    _string_list(next_steps, label="nextSteps")
    return manifest


def _parse_version(value: str) -> tuple[int, int, int]:
    match = _VERSION_RE.search(value)
    if not match:
        raise InstallerError(f"Could not parse runtime version from: {value!r}")
    return tuple(int(part or 0) for part in match.groups())  # type: ignore[return-value]


def _check_runtime(manifest: dict[str, Any]) -> dict[str, str]:
    runtime = manifest["runtime"]
    command = runtime["command"]
    executable = shutil.which(command)
    if not executable:
        raise InstallerError(f"Required runtime is not installed: {command}")
    completed = _run(
        [
            executable,
            *_string_list(
                runtime.get("versionArgs", ["--version"]),
                label="runtime.versionArgs",
            ),
        ],
        capture=True,
        timeout=30,
    )
    actual_text = (completed.stdout or completed.stderr).strip()
    actual = _parse_version(actual_text)
    minimum = _parse_version(runtime["minimumVersion"])
    if actual < minimum:
        raise InstallerError(
            f"{command} {runtime['minimumVersion']} or newer is required; found {actual_text}."
        )
    return {"command": executable, "version": actual_text}


def _reject_symlinks(component_path: Path) -> None:
    for path in component_path.rglob("*"):
        if path.is_symlink():
            raise InstallerError(
                f"MCP component contains a symlink, which is not installable: {path}"
            )


def _copy_component(source: Path, destination: Path) -> None:
    _reject_symlinks(source)

    def ignore(_directory: str, names: list[str]) -> set[str]:
        blocked = {"node_modules", "dist", "coverage", ".git", ".DS_Store", ".env"}
        return {
            name
            for name in names
            if name in blocked or (name.startswith(".env.") and name != ".env.example")
        }

    shutil.copytree(source, destination, ignore=ignore, dirs_exist_ok=True)


def _expand(
    value: str,
    *,
    install_dir: Path,
    hermes_home: Path,
    credential_file: Optional[Path],
) -> str:
    expanded = value.replace(INSTALL_DIR_TOKEN, str(install_dir)).replace(
        HERMES_HOME_TOKEN, str(hermes_home)
    )
    if CREDENTIAL_FILE_TOKEN in expanded:
        if credential_file is None:
            raise InstallerError("Manifest uses ${CREDENTIAL_FILE} without a credential target.")
        expanded = expanded.replace(CREDENTIAL_FILE_TOKEN, str(credential_file))
    return expanded


def _build_server_config(
    manifest: dict[str, Any],
    *,
    install_dir: Path,
    hermes_home: Path,
    credential_file: Optional[Path],
) -> tuple[str, dict[str, Any]]:
    transport = manifest["transport"]
    server_name = transport["serverName"]
    config: dict[str, Any] = {
        "command": _expand(
            transport["command"],
            install_dir=install_dir,
            hermes_home=hermes_home,
            credential_file=credential_file,
        ),
        "args": [
            _expand(
                value,
                install_dir=install_dir,
                hermes_home=hermes_home,
                credential_file=credential_file,
            )
            for value in transport.get("args", [])
        ],
    }
    if transport.get("env"):
        config["env"] = {
            key: _expand(
                value,
                install_dir=install_dir,
                hermes_home=hermes_home,
                credential_file=credential_file,
            )
            for key, value in transport["env"].items()
        }
    if transport.get("timeout"):
        config["timeout"] = transport["timeout"]
    if transport.get("connectTimeout"):
        config["connect_timeout"] = transport["connectTimeout"]
    return server_name, config


def _read_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise InstallerError(f"Cannot read Hermes config safely: {path}: {exc}") from exc
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise InstallerError(f"Hermes config must contain a YAML mapping: {path}")
    return value


def _write_config(path: Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    rendered = yaml.safe_dump(config, sort_keys=False, allow_unicode=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _credential_paths(
    manifest: dict[str, Any], hermes_home: Path
) -> tuple[Optional[Path], Optional[Path], Optional[Path]]:
    credentials = manifest.get("credentials")
    if not credentials:
        return None, None, None
    directory = hermes_home / _safe_relative_path(
        credentials["directory"], label="credentials.directory"
    )
    _require_within(hermes_home, directory, label="credentials.directory")
    template = None
    target = None
    if credentials.get("template"):
        template = _safe_relative_path(credentials["template"], label="credentials.template")
        target = hermes_home / _safe_relative_path(
            credentials["target"], label="credentials.target"
        )
        _require_within(directory, target, label="credentials.target")
    return directory, template, target


def _prepare_credentials(
    manifest: dict[str, Any],
    *,
    installed_dir: Path,
    hermes_home: Path,
) -> tuple[Optional[Path], bool]:
    directory, template_relative, target = _credential_paths(manifest, hermes_home)
    if directory is None:
        return None, False
    if directory.is_symlink():
        raise InstallerError(f"Credential directory must not be a symlink: {directory}")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        directory.chmod(0o700)
    except OSError:
        pass
    if template_relative is None or target is None:
        return None, False
    template = installed_dir / template_relative
    if not template.is_file():
        raise InstallerError(f"Credential template is missing from installed component: {template}")
    if target.is_symlink():
        raise InstallerError(f"Credential file must not be a symlink: {target}")
    if target.exists():
        if not target.is_file():
            raise InstallerError(f"Credential target is not a regular file: {target}")
        try:
            target.chmod(0o600)
        except OSError:
            pass
        return target, False
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(template, target)
    try:
        target.chmod(0o600)
    except OSError:
        pass
    return target, True


def _install_metadata(
    *, component_id: str, ref: str, commit: str, component_path: str
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "componentId": component_id,
        "repository": DEFAULT_REPOSITORY_URL,
        "requestedRef": ref,
        "resolvedCommit": commit,
        "componentPath": component_path,
        "installedAt": datetime.now(timezone.utc).isoformat(),
    }


def install(
    component_id: str,
    *,
    hermes_home: Path,
    ref: str,
    source_root: Optional[Path] = None,
    force: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    if not _COMPONENT_RE.fullmatch(component_id):
        raise InstallerError(f"Invalid MCP component ID: {component_id!r}")
    ref = _validate_ref(ref)
    hermes_home = hermes_home.expanduser().resolve()
    config_path = hermes_home / "config.yaml"
    install_root = hermes_home / "mcp-installs"
    install_dir = install_root / component_id
    if config_path.is_symlink():
        raise InstallerError(f"Hermes config must not be a symlink: {config_path}")
    if install_root.is_symlink():
        raise InstallerError(f"MCP install root must not be a symlink: {install_root}")
    _require_within(hermes_home, install_root, label="MCP install root")

    with tempfile.TemporaryDirectory(prefix="vantasoft-mcp-source-") as source_temp:
        if source_root is None:
            repository_root, commit = _fetch_repository(
                component_id,
                ref,
                Path(source_temp) / "repository",
            )
        else:
            repository_root, commit = _local_repository(source_root)
        catalog_entry, component_source = _catalog_component(repository_root, component_id)
        manifest = _validate_manifest(component_source / MANIFEST_FILENAME, component_id)
        runtime = _check_runtime(manifest)
        component_path = str(catalog_entry["path"])

        _, _, prospective_credential_file = _credential_paths(manifest, hermes_home)
        server_name, server_config = _build_server_config(
            manifest,
            install_dir=install_dir,
            hermes_home=hermes_home,
            credential_file=prospective_credential_file,
        )
        if server_config["command"] == manifest["runtime"]["command"]:
            server_config["command"] = runtime["command"]
        current_config = _read_config(config_path)
        configured_servers = current_config.get("mcp_servers", {})
        if not isinstance(configured_servers, dict):
            raise InstallerError("config.yaml mcp_servers must be a mapping.")
        has_existing_config = server_name in configured_servers

        if dry_run:
            return {
                "status": "planned",
                "componentId": component_id,
                "displayName": manifest["displayName"],
                "installDir": str(install_dir),
                "configPath": str(config_path),
                "serverName": server_name,
                "runtime": runtime,
                "source": {
                    "repository": DEFAULT_REPOSITORY_URL,
                    "requestedRef": ref,
                    "resolvedCommit": commit,
                    "componentPath": component_path,
                },
                "bootstrap": manifest["install"]["bootstrap"],
                "existingInstall": install_dir.exists(),
                "existingConfig": has_existing_config,
            }

        if (install_dir.exists() or has_existing_config) and not force:
            existing_locations = []
            if install_dir.exists():
                existing_locations.append(str(install_dir))
            if has_existing_config:
                existing_locations.append(f"config.yaml:mcp_servers.{server_name}")
            raise InstallerError(
                "MCP already has profile state at "
                f"{', '.join(existing_locations)}. Re-run with --force to replace it."
            )

        install_root.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=f".{component_id}-stage-", dir=install_root))
        backup = install_root / f".{component_id}-backup-{uuid.uuid4().hex}"
        original_config: Optional[bytes] = None
        config_existed = False
        config_touched = False
        created_credential: Optional[Path] = None
        moved_existing = False
        moved_stage = False
        try:
            _copy_component(component_source, stage)
            for command in _command_list(
                manifest["install"]["bootstrap"], label="install.bootstrap"
            ):
                _run(command, cwd=stage)
            for required in _string_list(
                manifest["install"]["requiredFiles"], label="install.requiredFiles"
            ):
                required_path = stage / _safe_relative_path(
                    required, label="install.requiredFiles entry"
                )
                if not required_path.is_file():
                    raise InstallerError(f"Bootstrap did not produce required file: {required}")

            metadata = _install_metadata(
                component_id=component_id,
                ref=ref,
                commit=commit,
                component_path=component_path,
            )
            (stage / INSTALL_METADATA_FILENAME).write_text(
                json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
            )

            if install_dir.exists() and not force:
                raise InstallerError(
                    f"MCP install appeared while bootstrap was running: {install_dir}"
                )
            if install_dir.exists():
                install_dir.rename(backup)
                moved_existing = True
            stage.rename(install_dir)
            moved_stage = True

            config_existed = config_path.exists()
            original_config = config_path.read_bytes() if config_existed else None
            config = _read_config(config_path)
            servers = config.setdefault("mcp_servers", {})
            if not isinstance(servers, dict):
                raise InstallerError("config.yaml mcp_servers must be a mapping.")
            if server_name in servers and not force:
                raise InstallerError(
                    "MCP server configuration appeared while bootstrap was running: "
                    f"mcp_servers.{server_name}"
                )
            existing = servers.get(server_name)
            if isinstance(existing, dict):
                for preserved_key in ("tools", "enabled"):
                    if preserved_key in existing:
                        server_config[preserved_key] = existing[preserved_key]
            servers[server_name] = server_config
            _write_config(config_path, config)
            config_touched = True

            credential_file, credential_created = _prepare_credentials(
                manifest,
                installed_dir=install_dir,
                hermes_home=hermes_home,
            )
            if credential_created:
                created_credential = credential_file

            next_steps = [
                _expand(
                    step,
                    install_dir=install_dir,
                    hermes_home=hermes_home,
                    credential_file=credential_file,
                )
                for step in manifest.get("nextSteps", [])
            ]
            result = {
                "status": "installed",
                "componentId": component_id,
                "displayName": manifest["displayName"],
                "installDir": str(install_dir),
                "configPath": str(config_path),
                "serverName": server_name,
                "runtime": runtime,
                "source": metadata,
                "credentialFile": str(credential_file) if credential_file else None,
                "credentialTemplateCreated": bool(created_credential),
                "nextSteps": next_steps,
            }
            if moved_existing and backup.exists():
                shutil.rmtree(backup)
            return result
        except Exception:
            if created_credential is not None:
                try:
                    created_credential.unlink()
                except FileNotFoundError:
                    pass
            if moved_stage and install_dir.exists():
                shutil.rmtree(install_dir)
            elif stage.exists():
                shutil.rmtree(stage)
            if moved_existing and backup.exists():
                backup.rename(install_dir)
            if config_touched:
                if not config_existed:
                    try:
                        config_path.unlink()
                    except FileNotFoundError:
                        pass
                elif original_config is not None:
                    config_path.parent.mkdir(parents=True, exist_ok=True)
                    config_path.write_bytes(original_config)
            raise
        finally:
            if stage.exists():
                shutil.rmtree(stage)
            if backup.exists() and not install_dir.exists():
                backup.rename(install_dir)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install a catalogued MCP from VantaSoft/vantasoft-hermes-library."
    )
    parser.add_argument("component", help="Catalog component ID, for example quickbooks-online")
    parser.add_argument(
        "--hermes-home",
        default=os.environ.get("HERMES_HOME") or str(Path.home() / ".hermes"),
        help="Target Hermes profile directory. Defaults to HERMES_HOME or ~/.hermes.",
    )
    parser.add_argument(
        "--ref",
        default="main",
        help="Git branch, tag, or commit to install. The resolved commit is recorded.",
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Atomically replace an existing installation while preserving tool filters.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve and validate the component without changing the profile.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = install(
            args.component,
            hermes_home=Path(args.hermes_home),
            ref=args.ref,
            source_root=args.source_root,
            force=args.force,
            dry_run=args.dry_run,
        )
    except InstallerError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 1
    except Exception as exc:  # fail closed without a traceback containing local data
        print(json.dumps({"status": "error", "error": f"Unexpected installer failure: {exc}"}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
