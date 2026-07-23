# QuickBooks Online MCP

A Hermes-compatible QuickBooks Online MCP server maintained in the VantaSoft extension library. It is based on Intuit's official [`quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server) and exposes broad QBO entity, transaction, and financial-report coverage over stdio.

## Why this server

I evaluated the active open-source QBO MCP implementations before importing this component. Intuit's server was the strongest baseline because it has first-party ownership, the broadest tested API surface, active maintenance, and substantially more adoption than the alternatives.

The VantaSoft version adds the deployment properties we need:

• New customer deployments use a unique OAuth Relay credential; VantaSoft's Intuit Client Secret remains central while customer access and refresh tokens are persisted locally.
• Legacy centralized broker mode remains available for controlled migration of existing connections.
• Relay and internal standalone token state defaults to `HERMES_HOME/mcp-tokens/quickbooks-online/.env`.
• Read tools are enabled by default, while create, update, and delete tools remain hidden unless an operator explicitly enables mutations.
• QBO upload errors are sanitized before logging so response bodies cannot leak company or account details.
• Initial OAuth binds only to `localhost`, validates a cryptographically random `state`, accepts only `GET /callback`, and never logs the authorization-code query string.
• Runtime dependencies are pinned and transitive security overrides are locked in `package-lock.json`.
• A real stdio MCP smoke test verifies the server starts and exposes only read tools by default.

See [`UPSTREAM.md`](UPSTREAM.md) for provenance. Intuit's [README at the imported revision](https://github.com/intuit/quickbooks-online-mcp-server/tree/099351858ee696dbbeb00dc7ca8e3a86276d86bb) contains the full upstream entity and tool reference.

## Capabilities

The server includes read and optional mutation tools across customers, invoices, estimates, bills, vendors, employees, accounts, items, journal entries, payments, purchases, sales receipts, credits, deposits, transfers, time activity, classes, departments, terms, tax data, company information, attachments, and other QBO entities.

Financial reports include:

• Balance Sheet
• Profit and Loss
• Cash Flow
• Trial Balance
• General Ledger
• Aged Receivables and Payables
• Customer Sales and Balances
• Vendor Expenses and Balances

## Build and verify

Node.js 20 or newer is required.

```bash
cd mcps/quickbooks-online
npm ci
npm test
npm run audit:prod
```

`npm test` builds the TypeScript source, runs the full upstream-derived unit suite, and connects through a real stdio MCP client to verify the default read-only tool catalog.

## Install from the VantaSoft library

The component includes [`mcp-install.json`](mcp-install.json) for the deterministic installer bundled with the `install-vantasoft-mcp` skill. After installing that skill from the VantaSoft tap, preview and install into the active profile with:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/install-vantasoft-mcp/scripts/install_mcp.py" \
  quickbooks-online \
  --hermes-home "${HERMES_HOME:-$HOME/.hermes}" \
  --ref main \
  --dry-run
```

Remove `--dry-run` after reviewing the plan. The installer downloads only this MCP subdirectory, runs `npm ci`, builds it, executes its stdio smoke test, installs it under `HERMES_HOME/mcp-installs/quickbooks-online`, writes the Hermes MCP configuration, and creates the credential template only when it does not already exist. Mutations remain disabled.

## Customer OAuth Relay setup

New customer deployments use the VantaSoft OAuth Relay. The initial profile-local credential file contains:

```dotenv
OAUTH_RELAY_URL=https://oauth.vantasoft.com
OAUTH_CONNECTION_ID=<customer-connection-uuid>
OAUTH_RELAY_TOKEN=<deployment-scoped-relay-token>
QUICKBOOKS_ENVIRONMENT=production
```

Provision this file through the relay operator before the customer authorizes Intuit. After authorization, the MCP retrieves the one-time encrypted handoff, atomically persists the access token, refresh token, expiration, and Realm ID, then acknowledges delivery. The relay deletes its token ciphertext after acknowledgment.

The MCP calls QBO directly with the local access token. When refresh is required, it sends the current refresh token to the relay, which adds VantaSoft's Intuit Client Secret and returns the rotated token bundle through another acknowledged handoff. A filesystem lock and stable idempotency key prevent concurrent consumers from racing Intuit's rotating refresh token.

### Legacy centralized broker mode

Existing connections can continue using `QUICKBOOKS_BROKER_URL`, `QUICKBOOKS_CONNECTION_ID`, and `QUICKBOOKS_BROKER_TOKEN` until a controlled migration is approved. Do not replace a live profile's broker variables manually. Broker mode continues to route through the central read-only proxy and exposes no raw Intuit tokens on that host.

## Internal standalone credential setup

Standalone mode is only for an owner-controlled backend or internal profile. It must not be deployed to an external customer host because it stores the Intuit app Client Secret and refresh token locally.

Create a QuickBooks Online app in the [Intuit Developer Portal](https://developer.intuit.com/), then prepare the active Hermes profile's token file:

```bash
export HERMES_HOME=/absolute/path/to/hermes/profile
mkdir -p "$HERMES_HOME/mcp-tokens/quickbooks-online"
cp .env.example "$HERMES_HOME/mcp-tokens/quickbooks-online/.env"
chmod 700 "$HERMES_HOME/mcp-tokens/quickbooks-online"
chmod 600 "$HERMES_HOME/mcp-tokens/quickbooks-online/.env"
```

Edit that profile-local `.env` and set the Intuit client ID, client secret, environment, and redirect URI. Do not place credentials in this repository.

For a sandbox app that accepts `http://localhost:8000/callback`, build and run the local OAuth helper:

```bash
npm run build
npm run auth
```

The helper saves the realm ID and refresh token to the active profile's token file. Refresh-token rotation is persisted there automatically.

Production Intuit apps require an approved HTTPS callback for the initial authorization. Use the VantaSoft OAuth Relay for customer production access. The local production bootstrap remains available only for an internal owner-controlled profile.

### Credential path precedence

• First: `QUICKBOOKS_ENV_FILE`, when explicitly set
• Second: `HERMES_HOME/mcp-tokens/quickbooks-online/.env`
• Third: the component-local `.env`, for non-Hermes compatibility

## Hermes configuration

Build the component, then add it to the profile's `config.yaml`:

```yaml
mcp_servers:
  quickbooks_online:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/quickbooks-online/dist/index.js
    env:
      QUICKBOOKS_ENABLE_MUTATIONS: "false"
      QUICKBOOKS_ENV_FILE: /absolute/path/to/hermes/profile/mcp-tokens/quickbooks-online/.env
```

Restart the profile or run `/reload-mcp`, then confirm the expected `mcp_quickbooks_online_*` tools are available.

For smaller prompts and tighter permissions, use Hermes MCP tool filtering:

```yaml
mcp_servers:
  quickbooks_online:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/quickbooks-online/dist/index.js
    tools:
      include:
        - get_company_info
        - get_profit_and_loss
        - get_balance_sheet
        - get_cash_flow
        - get_trial_balance
        - get_general_ledger
        - get_aged_receivables
        - get_aged_payables
```

## Enabling mutations

Mutations are intentionally hidden by default. An authorized operator may expose them by setting:

```yaml
mcp_servers:
  quickbooks_online:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/quickbooks-online/dist/index.js
    env:
      QUICKBOOKS_ENABLE_MUTATIONS: "true"
```

The category-specific flags `QUICKBOOKS_DISABLE_WRITE`, `QUICKBOOKS_DISABLE_UPDATE`, and `QUICKBOOKS_DISABLE_DELETE` can remove subsets after mutations are enabled.

Enabling the tools does not authorize an agent to move money, change production accounting data, or perform other high-impact actions without the required human approval.

## License

This component is distributed under Apache License 2.0. See [`LICENSE`](LICENSE). VantaSoft's modifications retain the upstream Intuit copyright and provenance.
