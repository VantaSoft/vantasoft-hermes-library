# MCP Install Manifest

Every MCP that can be installed by the `install-vantasoft-mcp` skill must be declared in the root [`catalog.json`](../catalog.json) and include an `mcp-install.json` file inside its component directory.

The manifest is execution policy, not merely documentation. The installer validates it before changing a profile and executes bootstrap commands without a shell.

## Catalog contract

An installable MCP entry uses this shape:

```json
{
  "id": "example-mcp",
  "name": "Example MCP",
  "type": "mcp",
  "path": "mcps/example-mcp",
  "installManifest": "mcps/example-mcp/mcp-install.json",
  "profileScoped": true
}
```

The component ID must be a lowercase slug. The installer resolves only entries whose type is `mcp`, verifies that the component path stays inside the repository, and requires `installManifest` to point to that component's `mcp-install.json`.

## Manifest schema

Current manifests use `schemaVersion: 1`:

```json
{
  "schemaVersion": 1,
  "componentId": "example-mcp",
  "displayName": "Example MCP",
  "runtime": {
    "command": "node",
    "minimumVersion": "20.0.0",
    "versionArgs": ["--version"]
  },
  "install": {
    "bootstrap": [
      ["npm", "ci", "--ignore-scripts"],
      ["npm", "run", "build"],
      ["npm", "test"],
      ["npm", "prune", "--omit=dev", "--ignore-scripts"]
    ],
    "requiredFiles": ["dist/index.js"]
  },
  "transport": {
    "serverName": "example_mcp",
    "command": "node",
    "args": ["${INSTALL_DIR}/dist/index.js"],
    "env": {
      "EXAMPLE_SAFE_MODE": "true",
      "EXAMPLE_CREDENTIAL_FILE": "${CREDENTIAL_FILE}"
    },
    "timeout": 120,
    "connectTimeout": 30
  },
  "credentials": {
    "directory": "mcp-tokens/example-mcp",
    "template": ".env.example",
    "target": "mcp-tokens/example-mcp/.env"
  },
  "nextSteps": [
    "Complete ${CREDENTIAL_FILE} locally.",
    "Reload the MCP server for ${HERMES_HOME}."
  ]
}
```

## Field reference

### Top level

• `schemaVersion`: required integer. Version 1 is currently supported.
• `componentId`: required. Must match the requested catalog component exactly.
• `displayName`: required human-facing name.
• `safeDefault`: optional descriptive value for review and documentation. Runtime safety must still be enforced by the transport environment or tool selection.
• `runtime`: required runtime check.
• `install`: required deterministic bootstrap policy.
• `transport`: required Hermes MCP configuration.
• `credentials`: optional local credential-directory preparation.
• `nextSteps`: optional operator instructions returned after installation.

### Runtime

• `command`: executable that must be on `PATH`, such as `node`.
• `minimumVersion`: minimum semantic version accepted by the installer.
• `versionArgs`: argument array used to read the installed runtime version.

### Install

• `bootstrap`: ordered list of argument arrays. Commands execute directly in the staged component directory without shell expansion.
• `requiredFiles`: relative files that must exist after bootstrap completes. Missing artifacts fail the installation before profile state changes.

Use lockfile-based dependency installation. Run the component's real build and targeted smoke tests before pruning development dependencies. Do not place secret values in bootstrap commands.

### Transport

• `serverName`: key written under `mcp_servers` in the target profile.
• `command`: stdio process command.
• `args`: stdio process arguments.
• `env`: optional non-secret runtime defaults and resolved paths. Never put credential values here.
• `timeout`: optional tool-call timeout in seconds.
• `connectTimeout`: optional initial connection timeout in seconds.

`command`, `args`, `env` values, and `nextSteps` may use:

• `${INSTALL_DIR}`: final profile-local component directory.
• `${HERMES_HOME}`: target profile directory.
• `${CREDENTIAL_FILE}`: credential target declared by `credentials.target`.

### Credentials

• `directory`: profile-relative directory to create with restrictive permissions.
• `template`: optional component-relative example file.
• `target`: required with `template`; profile-relative destination copied only when absent.

The installer never overwrites an existing credential file and never accepts credential values. OAuth and secret entry remain local operator actions.

## Transaction and update behavior

The installer builds in a staging directory under the target profile. Only after bootstrap and required-file checks pass does it swap the installation into `HERMES_HOME/mcp-installs/<component-id>` and update `config.yaml`.

On reinstall, `--force` is required. The same guard applies when the server name already exists in `config.yaml`, even if there is no installer-managed directory yet. Existing Hermes `tools` filtering and `enabled` state are preserved, while manifest transport defaults are reapplied. Existing credential files are preserved. If a later step fails, the prior installed directory and prior config are restored.

Each successful install records non-secret provenance in:

```text
HERMES_HOME/mcp-installs/<component-id>/.vantasoft-mcp-install.json
```

The metadata includes the repository, requested ref, exact resolved commit, component path, and installation time.

## Adding a new MCP

1. Add the MCP source under `mcps/<component-id>/`.
2. Include a lockfile and deterministic build scripts.
3. Add `mcp-install.json` using argument-array bootstrap commands.
4. Add the MCP to `catalog.json` with its exact `installManifest` path.
5. Add unit, build, and stdio smoke coverage inside the component.
6. Extend `tests/test_install_vantasoft_mcp.py` only for new behavior, not to freeze tool or component counts.
7. Run the installer against a temporary `HERMES_HOME` and verify the installed process through MCP `tools/list`.
8. Confirm that no credentials, tokens, local `.env` files, build output, or `node_modules` entered Git.
