# VantaSoft Hermes Library

Reusable Hermes plugins, MCP servers, and skills maintained by VantaSoft.

This repository is the source library for extension code that should evolve independently from the [`vantasoft-hermes-agent`](https://github.com/VantaSoft/vantasoft-hermes-agent) fork. Deployments can select only the components they need.

## Components

Components are organized by type under `plugins/`, `mcps/`, and `skills/`.

### Plugins

#### Agent Messaging

Path: [`plugins/agent-messaging`](plugins/agent-messaging)

Hermes-native peer profile discovery, tracked cross-profile messaging, explicit replies, and conversation resumption. This unbranded plugin supersedes the earlier `vantasoft-hermes-plugin` and `vantasoft-agents` names.

### MCPs

#### Google Workspace

Path: [`mcps/google-workspace`](mcps/google-workspace)

A Gmail, Calendar, Drive, Docs, and Sheets MCP server with multiple profile-local Google accounts. It uses `HERMES_HOME/mcp-tokens/google-workspace`, supports explicit and default account selection, refreshes locally, and has no token-service dependency.

#### QuickBooks Online

Path: [`mcps/quickbooks-online`](mcps/quickbooks-online)

A profile-local QuickBooks Online MCP server based on Intuit's official implementation. It provides broad entity and financial-report coverage, persists OAuth rotation under `HERMES_HOME/mcp-tokens/quickbooks-online`, and hides all create, update, and delete tools until an operator explicitly enables mutations.

#### Shopify Admin

Path: [`mcps/shopify-admin`](mcps/shopify-admin)

A portable multi-store Shopify Admin GraphQL MCP built on Shopify's official client. It exposes 22 curated read tools by default, minimizes customer and order data, rejects arbitrary API hosts, and adds only six limited mutation tools after an explicit opt-in.

### Skills

#### Create Agent Profile

Path: [`skills/create-agent-profile`](skills/create-agent-profile)

The canonical installable workflow and reviewed bare-minimum config template for creating named, zero-skill VantaSoft Hermes profiles without cloning credentials, memories, sessions, or customer state. The VantaSoft Hermes Agent fork also bundles this same flat package so first-run and managed-host bootstrap work without a prior tap or network lookup.

#### Approval-Gated Email

Path: [`skills/approval-gated-email`](skills/approval-gated-email)

A provider-aware Gmail workflow that keeps new messages, replies, forwards, and provider-side drafts behind explicit human approval. It preserves original message and thread identifiers, participant intent, attachments, account selection, and safe retry behavior.

#### Approval-Gated Calendar

Path: [`skills/approval-gated-calendar`](skills/approval-gated-calendar)

A Google Calendar workflow that keeps event creation, updates, and deletion behind explicit human approval. It covers account and attendee resolution, timezone-safe scheduling, availability and duplicate checks, invitation notifications, conferencing, and post-action verification.

#### Slack App Manifest

Path: [`skills/slack-app-manifest`](skills/slack-app-manifest)

An a-la-carte Hermes skill containing the prompting, validated template, and deterministic generator for named Slack agents. It installs independently and registers no runtime integration tools.

#### Install VantaSoft MCP

Path: [`skills/install-vantasoft-mcp`](skills/install-vantasoft-mcp)

A profile-aware installation workflow with a bundled deterministic installer. It retrieves one catalogued MCP subdirectory through Git sparse checkout, validates the component's `mcp-install.json`, runs its dependency installation, build, and smoke checks, writes the profile-local MCP configuration atomically, and leaves credential entry to the authorized operator's local machine.

## Mix and match by profile

Components are independently configured in each Hermes profile.

Example profile using both Google Workspace and peer messaging:

```yaml
plugins:
  enabled:
    - agent-messaging

platform_toolsets:
  slack:
    - agent_messaging

mcp_servers:
  google_workspace:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/google-workspace/dist/index.js
```

Another profile can enable only `agent-messaging`, only Google Workspace, or neither. The Slack manifest skill can be installed independently in any profile that performs agent setup. Google OAuth state and other component credentials must remain inside that profile's `HERMES_HOME`.

## Install the directory plugin

```bash
hermes plugins install VantaSoft/vantasoft-hermes-library/plugins/agent-messaging --enable
```

Hermes supports installing a plugin from a repository subdirectory, but its current subdirectory update path does not retain Git metadata. Until that upstream limitation is fixed, update with `--force` using the same install command.

## Build Google Workspace MCP

```bash
cd mcps/google-workspace
npm ci
npm test
```

See the component README for OAuth setup and profile configuration.

## Build QuickBooks Online MCP

```bash
cd mcps/quickbooks-online
npm ci
npm test
npm run audit:prod
```

See the component README for profile-local Intuit OAuth setup, Hermes configuration, tool filtering, and the explicit mutation opt-in.

## Build Shopify Admin MCP

```bash
cd mcps/shopify-admin
npm ci
npm test
npm run lint
npm audit --audit-level=high
```

See the component README for multi-store credentials, Admin API scopes, Hermes configuration, privacy controls, and mutation gating.

## Install an MCP into a Hermes profile

Install the reusable workflow from the public tap:

```bash
hermes skills tap add VantaSoft/vantasoft-hermes-library
hermes skills install VantaSoft/vantasoft-hermes-library/install-vantasoft-mcp
```

Then ask the agent to install a catalogued library MCP, or invoke the bundled installer directly:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/install-vantasoft-mcp/scripts/install_mcp.py" \
  quickbooks-online \
  --hermes-home "${HERMES_HOME:-$HOME/.hermes}" \
  --ref main \
  --dry-run
```

Remove `--dry-run` after reviewing the JSON plan. The installer records the exact resolved commit even when a branch name is supplied. It never accepts credential values, never overwrites an existing credential file, and requires `--force` before replacing an installed component. See the [`mcp-install.json` schema and component contract](docs/mcp-install-manifest.md) when adding another MCP.

## Install skills

```bash
hermes skills tap add VantaSoft/vantasoft-hermes-library
hermes skills install VantaSoft/vantasoft-hermes-library/create-agent-profile
hermes skills install VantaSoft/vantasoft-hermes-library/approval-gated-email
hermes skills install VantaSoft/vantasoft-hermes-library/approval-gated-calendar
hermes skills install VantaSoft/vantasoft-hermes-library/slack-app-manifest
hermes skills install VantaSoft/vantasoft-hermes-library/install-vantasoft-mcp
```

After installation, invoke a skill by name or ask the agent for the corresponding workflow. The approval-gated communication skills are designed for profiles using this repository's Google Workspace MCP.

## Development

Python formatting and tests:

```bash
python -m ruff check plugins skills tests
python -m pytest -q tests/test_slack_manifest.py tests/test_approval_gated_skills.py tests/test_create_agent_profile.py tests/test_install_vantasoft_mcp.py
```

The `agent-messaging` suite must run against a compatible VantaSoft Hermes Agent checkout:

```bash
PYTHONPATH=/path/to/vantasoft-hermes-agent \
  python -m pytest -q tests/plugins/agent_messaging
```

Node tests:

```bash
npm --prefix mcps/google-workspace test
npm --prefix mcps/quickbooks-online test
npm --prefix mcps/quickbooks-online run audit:prod
npm --prefix mcps/shopify-admin test
npm --prefix mcps/shopify-admin run lint
npm --prefix mcps/shopify-admin audit --audit-level=high
```

Never commit OAuth tokens, client secrets, Slack tokens, signing secrets, profile `.env` files, or customer credentials.

## License

MIT. See [LICENSE](LICENSE).
