# VantaSoft Hermes Plugins

Reusable Hermes plugins, MCP servers, and setup assets maintained by VantaSoft.

This repository is the source catalog for extension code that should evolve independently from the [`vantasoft-hermes-agent`](https://github.com/VantaSoft/vantasoft-hermes-agent) fork. Deployments can select only the components they need.

## Catalog

### Google Workspace MCP

Path: [`mcps/google-workspace`](mcps/google-workspace)

A Gmail, Calendar, Drive, Docs, and Sheets MCP server with multiple profile-local Google accounts. It uses `HERMES_HOME/mcp-tokens/google-workspace`, supports explicit and default account selection, refreshes locally, and has no token-service dependency.

### VantaSoft Agents plugin

Path: [`plugins/vantasoft-agents`](plugins/vantasoft-agents)

Hermes-native peer profile discovery, tracked cross-profile messaging, explicit replies, and conversation resumption. This plugin was previously maintained as `vantasoft-hermes-plugin`; the VantaSoft fork currently bundles a pinned copy under the live name `vantasoft-agents`.

### Simplified Slack app manifest

Path: [`templates/slack-app`](templates/slack-app)

A validated Slack app manifest template and generator for named Hermes agents. This is a provisioning asset rather than a runtime plugin because it registers no tools, hooks, commands, or adapters.

## Mix and match by profile

Components are independently configured in each Hermes profile.

Example profile using both Google Workspace and peer messaging:

```yaml
plugins:
  enabled:
    - vantasoft-agents

platform_toolsets:
  slack:
    - agent_messaging

mcp_servers:
  google_workspace:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-plugins/mcps/google-workspace/dist/index.js
```

Another profile can enable only `vantasoft-agents`, only Google Workspace, or neither. Google OAuth state and other component credentials must remain inside that profile's `HERMES_HOME`.

## Install the directory plugin

```bash
hermes plugins install VantaSoft/vantasoft-hermes-plugins/plugins/vantasoft-agents --enable
```

Hermes supports installing a plugin from a repository subdirectory, but its current subdirectory update path does not retain Git metadata. Until that upstream limitation is fixed, update with `--force` using the same install command.

## Build Google Workspace MCP

```bash
cd mcps/google-workspace
npm ci
npm test
```

See the component README for OAuth setup and profile configuration.

## Generate a Slack manifest

```bash
python templates/slack-app/generate.py \
  --name "Agent Name" \
  --description "Short agent description"
```

## Development

Python formatting and tests:

```bash
python -m ruff check plugins templates tests
python -m pytest -q tests/test_slack_manifest.py
```

The `vantasoft-agents` suite must run against a compatible VantaSoft Hermes Agent checkout:

```bash
PYTHONPATH=/path/to/vantasoft-hermes-agent \
  python -m pytest -q tests/plugins/vantasoft_agents
```

Node tests:

```bash
npm --prefix mcps/google-workspace test
```

Never commit OAuth tokens, client secrets, Slack tokens, signing secrets, profile `.env` files, or customer credentials.

## License

MIT. See [LICENSE](LICENSE).
