# Telvana Admin MCP

A profile-local, read-only-by-default Model Context Protocol server for approved Telvana API administration. It wraps Telvana's workspace-scoped API-key routes and deliberately exposes no database, infrastructure, deletion, archival, deployment, credential-management, or production-enablement tools.

## Security model

• One server process selects exactly one environment through `TELVANA_ENVIRONMENT`.
• Development, staging, and production credentials are separate entries in a profile-local credential file.
• Staging and production endpoints must use HTTPS. Plain HTTP is limited to a loopback development endpoint.
• Production additionally requires `TELVANA_ALLOW_PRODUCTION=true`; production is omitted from the example credential file.
• Mutation tools are hidden unless both `TELVANA_ENABLE_MUTATIONS=true` and the selected credential entry has `allowMutations: true`.
• Every mutation requires `confirmEnvironment` to equal the process-selected environment.
• All API access uses a workspace-scoped `x-api-key`. The key is never returned, logged, or included in surfaced upstream errors.
• Audit records contain actor, environment, tool, operation type, target IDs, request ID, outcome, and safe error code. They exclude tool payloads, prompts, reasons, response bodies, headers, and credentials.
• A failed initial audit write prevents the API call. If final audit persistence fails after a call, the tool returns an explicit ambiguous-state error so the caller verifies before retrying.

Profiles on one operating-system account are not a security boundary. Use host or container isolation when separate trust boundaries are required.

## Versioned tool catalog

Catalog version: `2026-07-21.v1`.

Read tools are always available:

• `telvana_get_server_info`: selected environment and safe server capabilities.
• `telvana_get_tool_catalog`: catalog version, operation type, resource, and enabled state.
• `telvana_get_agent`: one workspace-scoped agent configuration.
• `telvana_list_outbound_prompts`: outbound prompts for one agent.
• `telvana_get_outbound_prompt`: one outbound prompt for one agent.

Mutation tools are available only after the two-part opt-in:

• `telvana_update_inbound_prompt`: replace an agent's inbound prompt.
• `telvana_update_agent_settings`: update an allowlisted subset of non-secret agent settings.
• `telvana_update_outbound_prompt`: update an outbound prompt title or instructions.

No initial-release tool deletes data, changes infrastructure, manages servers, runs database commands, changes credentials, creates API keys, deploys code, or enables production.

## Credential file

The default credential path is:

```text
${HERMES_HOME}/mcp-tokens/telvana-admin/credentials.json
```

Override it with `TELVANA_CREDENTIALS_FILE`. Start from `credentials.example.json` and add only the environment entries the profile is approved to access:

```json
{
  "environments": {
    "development": {
      "baseUrl": "http://127.0.0.1:3000",
      "apiKey": "enter-locally",
      "allowMutations": false
    },
    "staging": {
      "baseUrl": "https://staging-api.example.com",
      "apiKey": "enter-locally",
      "allowMutations": false
    }
  }
}
```

Use a distinct workspace-scoped key for each environment. Do not reuse a production key in development or staging. Keep the directory at mode `0700` and the credential file at mode `0600` where supported. The server applies those modes on load.

## Local development

Requirements: Node.js 20 or newer.

```bash
npm ci
npm test
npm run lint
npm run audit:prod
```

Configure a local development process:

```bash
export TELVANA_ENVIRONMENT=development
export TELVANA_MCP_ACTOR=markus
export TELVANA_ENABLE_MUTATIONS=false
export TELVANA_ALLOW_PRODUCTION=false
export TELVANA_CREDENTIALS_FILE=/absolute/path/to/credentials.json
npm start
```

`TELVANA_ENVIRONMENT` and `TELVANA_MCP_ACTOR` are mandatory. The server does not guess either value.

## Install into a Hermes profile

Use the library installer after this component is published:

```bash
python3 "${HERMES_HOME}/skills/install-vantasoft-mcp/scripts/install_mcp.py" \
  telvana-admin \
  --hermes-home "${HERMES_HOME}" \
  --ref <reviewed-tag-or-commit> \
  --dry-run
```

Review the plan, then rerun without `--dry-run`. Complete the profile-local credential file directly on the host. Add the required non-secret environment values to the installed `mcp_servers.telvana_admin.env` configuration:

```yaml
env:
  TELVANA_ENVIRONMENT: development
  TELVANA_MCP_ACTOR: markus
  TELVANA_ENABLE_MUTATIONS: "false"
  TELVANA_ALLOW_PRODUCTION: "false"
```

Reload MCP servers or restart the profile gateway. Confirm `telvana_get_server_info` and `telvana_get_tool_catalog` before calling resource tools.

## Audit logs

The default audit path is:

```text
${HERMES_HOME}/mcp-logs/telvana-admin/audit.jsonl
```

Override it with `TELVANA_AUDIT_FILE`. Restrict access to the profile operator and send it to an approved log sink if durable central retention is required. A typical record is:

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-07-21T00:00:00.000Z",
  "actor": "markus",
  "environment": "staging",
  "tool": "telvana_get_agent",
  "operation": "read",
  "requestId": "...",
  "target": { "agentId": "..." },
  "outcome": "success"
}
```

## Authorized staging smoke test

The smoke test discovers tools, reads one approved staging agent, and performs one idempotent update by writing the agent's existing inbound prompt back unchanged. It refuses any environment except staging and refuses to run if production is enabled.

An authorized operator must first configure a least-privilege staging key, set that staging entry's `allowMutations` to `true`, approve the target agent, and then run:

```bash
TELVANA_ENVIRONMENT=staging \
TELVANA_MCP_ACTOR=markus:staging-smoke \
TELVANA_ENABLE_MUTATIONS=true \
TELVANA_ALLOW_PRODUCTION=false \
TELVANA_SMOKE_AGENT_ID=<approved-staging-agent-id> \
npm run smoke:staging
```

After the test, restore the staging credential entry's `allowMutations` to `false` unless continued mutation access was separately approved.

## Deployment and rollback

Deployment is profile-local installation pinned to a reviewed Git tag or full commit SHA. Do not point a durable installation at an unreviewed moving branch.

To roll back:

1. Identify the last reviewed tag or commit from `.vantasoft-mcp-install.json` or the change record.
2. Rerun the installer with that ref and `--force`; existing credentials are preserved.
3. Keep mutations and production disabled during rollback.
4. Reload the MCP server and verify the read-only catalog before restoring any separately approved mutation access.

Rollback changes only the installed MCP code and configuration defaults. It does not revert Telvana API mutations. Revert an application-level prompt or setting through the approved API workflow using a known-good value.

## Credential rotation

1. Create a new least-privilege API key in the selected Telvana environment through the approved portal workflow.
2. Replace only that environment's `apiKey` in the local credential file. Never send it through chat or put it in Git.
3. Reload the MCP server and run `telvana_get_agent` against an approved non-sensitive resource.
4. Revoke the old key after the new key is verified.
5. Review audit records for unexpected authorization failures.

Credential creation, rotation, revocation, and production enablement remain operator actions outside this MCP.
