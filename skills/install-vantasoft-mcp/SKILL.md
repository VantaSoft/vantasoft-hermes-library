---
name: install-vantasoft-mcp
description: Install and configure a catalogued MCP from the VantaSoft Hermes Library
version: 1.0.0
author: VantaSoft
license: MIT
metadata:
  hermes:
    category: integrations
    tags: [mcp, installation, setup, vantasoft]
    requires_toolsets: [terminal, file]
    homepage: https://github.com/VantaSoft/vantasoft-hermes-library/tree/main/skills/install-vantasoft-mcp
---

# Install VantaSoft MCP

Install one catalogued MCP from `VantaSoft/vantasoft-hermes-library` into a specific Hermes profile using the bundled deterministic installer. The installer downloads only the selected MCP source directory through Git sparse checkout, validates its component manifest, installs dependencies, runs the component's real build and smoke checks, places it under the profile's `mcp-installs/`, and atomically updates `config.yaml`.

## When to Use

Use this skill when:

• installing a VantaSoft-library MCP into a Hermes profile;
• previewing an MCP installation before changing the profile;
• reinstalling or updating a previously installed VantaSoft MCP;
• configuring a new profile with a role-required MCP without cloning another profile's integration state.

Do not use this skill for arbitrary repositories, Hermes directory plugins, skills, or remote HTTP MCP endpoints. It installs only components declared as `type: mcp` in the VantaSoft library's `catalog.json` and carrying a valid `mcp-install.json` manifest. The canonical manifest contract lives in the library's [MCP install manifest reference](https://github.com/VantaSoft/vantasoft-hermes-library/blob/main/docs/mcp-install-manifest.md).

## Security Rules

• Never ask the user to paste OAuth client secrets, refresh tokens, API keys, realm IDs, private keys, or credential files into chat.
• Never pass credential values as installer arguments or write them into `config.yaml`.
• Keep credential setup local to the target profile's `mcp-tokens/` directory.
• Do not use `--force` unless the user explicitly requested an update or reinstall, or already approved replacing that installed component.
• Do not install into another profile merely because it exists. Resolve the intended `HERMES_HOME` from the current session or the user's explicit target.
• Preserve existing credentials. The installer creates only missing credential directories or checked-in example files and never overwrites existing credential files.
• Keep mutation-capable MCPs at their manifest's safe default. For QuickBooks Online, the installer must leave `QUICKBOOKS_ENABLE_MUTATIONS` set to `"false"`.
• Prefer a tag or full commit SHA supplied by the operator for durable deployments. If `main` is used, report the exact resolved commit recorded by the installer.

## Bundled Installer

Resolve this installed skill's directory. Its normal location is:

```text
${HERMES_HOME:-$HOME/.hermes}/skills/integrations/install-vantasoft-mcp
```

The installer is:

```text
scripts/install_mcp.py
```

It requires Python 3.9 or newer, Git, the component runtime, and the package manager declared by the component manifest. When the ambient `python3` lacks Hermes dependencies, the script automatically re-executes with the interpreter next to the active `hermes` executable. Current Node MCPs require Node.js 20 or newer and npm.

## Procedure

### 1. Resolve the target profile

Determine the exact target `HERMES_HOME` without reading credential values. If the current session is already running in the intended profile, use its active `HERMES_HOME`. If the user named another profile, resolve its profile directory explicitly. Ask one plain-text clarification only when the target profile genuinely cannot be determined.

Inspect, without printing secrets:

```text
<HERMES_HOME>/config.yaml
<HERMES_HOME>/mcp-installs/<component-id>/.vantasoft-mcp-install.json
```

The metadata file may not exist on a first install.

### 2. Preview the installation

Run the installer in dry-run mode first:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/install-vantasoft-mcp/scripts/install_mcp.py" \
  <component-id> \
  --hermes-home "<target-HERMES_HOME>" \
  --ref "<tag-branch-or-commit>" \
  --dry-run
```

Parse the JSON result. Confirm that the component ID, installation directory, MCP server name, runtime, source commit, and bootstrap commands match the request. Dry-run may fetch source metadata, but it must not modify the target profile.

### 3. Install

For a first installation:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/install-vantasoft-mcp/scripts/install_mcp.py" \
  <component-id> \
  --hermes-home "<target-HERMES_HOME>" \
  --ref "<tag-branch-or-commit>"
```

For an explicitly approved update or reinstall, add `--force`:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/install-vantasoft-mcp/scripts/install_mcp.py" \
  <component-id> \
  --hermes-home "<target-HERMES_HOME>" \
  --ref "<new-tag-branch-or-commit>" \
  --force
```

The script prints bootstrap progress to stderr and one JSON result to stdout. Treat any nonzero exit or `{"status":"error"}` result as a failed installation. Do not claim success from a partially created directory.

### 4. Complete credentials locally

Follow the returned `nextSteps`, but never collect the credential values in chat. Tell the authorized operator exactly which local file or local OAuth command to use.

For QuickBooks Online, the expected credential file is:

```text
<TARGET_HERMES_HOME>/mcp-tokens/quickbooks-online/.env
```

The installer copies `.env.example` there only when the file does not already exist and applies restrictive permissions where supported. The authorized operator completes it locally and performs the Intuit OAuth flow. Production Intuit apps require an approved HTTPS callback or Intuit OAuth tooling for the initial grant.

For Google Workspace, the operator places the OAuth desktop client at:

```text
<TARGET_HERMES_HOME>/mcp-tokens/google-workspace/client.json
```

The operator then runs the returned local account-authorization command.

### 5. Reload and verify

After credentials are ready, reload MCP servers or restart the target gateway through the deployment's normal supervisor. Then verify:

• the target `config.yaml` contains the expected `mcp_servers.<server-name>` block;
• its command points inside the target profile's `mcp-installs/<component-id>/dist/`;
• the installation metadata records the expected repository, requested ref, and resolved commit;
• the server starts and responds to MCP `tools/list`;
• any manifest safe default remains enforced;
• no credential values appear in config, logs, chat, or Git.

For QuickBooks Online, confirm that read tools are present and create, update, and delete tools are absent unless an authorized operator separately approved mutations.

## Installer Behavior

The installer:

• retrieves only `mcps/<component-id>` from the public VantaSoft library using Git sparse checkout;
• validates the root catalog entry and component `mcp-install.json`;
• rejects path traversal, unsupported schemas, invalid commands, and component symlinks;
• checks the declared runtime and minimum version;
• copies source into a profile-local staging directory while excluding `.env`, `node_modules`, `dist`, coverage, and Git metadata;
• executes bootstrap commands as argument arrays without a shell;
• requires the manifest's expected build artifacts;
• atomically swaps the completed installation into place;
• refuses to replace either an existing install directory or an existing server configuration unless `--force` is explicit;
• atomically updates `config.yaml`, preserving existing `tools` filters and `enabled` state on reinstall;
• rolls back the installed directory and config if a later installation step fails;
• records non-secret source provenance in `.vantasoft-mcp-install.json`;
• never overwrites an existing credential file.

## Pitfalls

• Do not run `npm install` against the monorepo root. Each MCP is an independently manifested subdirectory.
• Do not manually copy a working profile's token directory into another profile.
• Do not use a floating `main` install without reporting the resolved commit.
• Do not treat a successful build as proof that OAuth or a live external account works.
• Do not expose every available tool merely because the MCP provides it. Keep the component's safe defaults and use Hermes `tools.include` filtering when appropriate.
• Do not confuse a Hermes directory plugin with an MCP. Plugins are imported Python directories; MCPs are separately launched processes with their own runtime and dependency bootstrap.

## Verification Checklist

Before reporting completion, confirm:

• dry-run returned `status: planned`;
• install returned `status: installed`;
• the component's bootstrap and smoke checks passed;
• `config.yaml` parses after the atomic update;
• the install path and recorded commit match the JSON result;
• credential setup is either complete locally or clearly reported as remaining;
• the target MCP server has been reloaded and tested, or that live verification is explicitly reported as pending credentials.
