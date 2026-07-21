# Google Workspace MCP

Profile-local Google Workspace MCP server for Gmail, Calendar, Drive, Docs, and Sheets. It supports multiple named Google accounts without token-service or another centralized credential system.

## Authentication model

The server resolves the active Hermes profile through `HERMES_HOME` and stores OAuth material under:

```text
HERMES_HOME/mcp-tokens/google-workspace/
├── client.json
├── config.json
└── accounts/
    ├── personal.json
    └── work.json
```

Hermes already treats `mcp-tokens/` as a protected credential directory. Account names are validated lowercase slugs. Secret-bearing files are written atomically with mode `0600`, and directories use mode `0700`, where the platform supports POSIX permissions.

`GOOGLE_MCP_CONFIG_DIR` can override the credential directory for testing or non-Hermes hosts. Do not point multiple unrelated Hermes profiles at one credential directory.

## Install and build

Requirements:

• Node.js 20 or newer.
• A Google Cloud OAuth desktop client.
• Gmail, Calendar, and Drive APIs enabled in the Google Cloud project.

```bash
cd mcps/google-workspace
npm ci
npm run build
```

### Install from the VantaSoft library

The component includes [`mcp-install.json`](mcp-install.json) for the deterministic installer bundled with the `install-vantasoft-mcp` skill. After installing that skill from the VantaSoft tap, preview and install into the active profile with:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/install-vantasoft-mcp/scripts/install_mcp.py" \
  google-workspace \
  --hermes-home "${HERMES_HOME:-$HOME/.hermes}" \
  --ref main \
  --dry-run
```

Remove `--dry-run` after reviewing the plan. The installer downloads only this MCP subdirectory, builds and tests it, installs it under `HERMES_HOME/mcp-installs/google-workspace`, writes the Hermes MCP configuration, and prepares the profile-local credential directory without creating or copying OAuth grants.

## Configure OAuth

Download a Google OAuth desktop client JSON and save it as:

```text
HERMES_HOME/mcp-tokens/google-workspace/client.json
```

Authorize accounts independently:

```bash
HERMES_HOME=/path/to/profile npm run setup -- auth personal
HERMES_HOME=/path/to/profile npm run setup -- auth work
```

Manage local accounts:

```bash
HERMES_HOME=/path/to/profile npm run setup -- list
HERMES_HOME=/path/to/profile npm run setup -- set-default work
HERMES_HOME=/path/to/profile npm run setup -- status
HERMES_HOME=/path/to/profile npm run setup -- revoke personal
```

The OAuth callback listens only on `127.0.0.1:3000`, validates a random state value, uses PKCE, and times out after five minutes.

## Hermes configuration

Add the server to the profile's `config.yaml`:

```yaml
mcp_servers:
  google_workspace:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/google-workspace/dist/index.js
```

The MCP process inherits the profile's `HERMES_HOME`. Do not set `TOKEN_SERVICE_URL`, `TOKEN_SERVICE_API_KEY`, or a shared token directory.

Restart the profile gateway after adding or changing MCP configuration. Hermes exposes the tools with its normal MCP prefix, typically `mcp_google_workspace_`.

## Account selection

Every Google Workspace tool accepts an optional `account` argument.

• Omit `account` to use the profile-local default.
• Pass a configured slug such as `personal` or `work` to select explicitly.
• Use `gw_list_accounts` to list configured accounts.
• Use the setup command to change the default.
• If multiple accounts exist and no valid default is configured, the server fails clearly instead of guessing.

All accounts inside one Hermes profile share that profile's trust boundary. Use separate profiles or deployments when identities need hard isolation.

## Development

```bash
npm test
```

The tests cover slug validation, profile-local storage, multi-account selection, default changes, token refresh merging, file permissions, and OAuth client construction without accessing a real Google account.

## License

MIT. See the repository-level `LICENSE` file.
