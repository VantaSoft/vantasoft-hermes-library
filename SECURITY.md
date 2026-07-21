# Security

Report suspected vulnerabilities privately to VantaSoft before public disclosure.

## Credential handling

• Never commit OAuth client secrets, access tokens, refresh tokens, Slack tokens, signing secrets, `.env` files, customer credentials, or credential fragments.
• Google Workspace credentials belong under the active profile's `HERMES_HOME/mcp-tokens/google-workspace` directory.
• QuickBooks Online credentials belong in `HERMES_HOME/mcp-tokens/quickbooks-online/.env`, with directory mode `0700` and file mode `0600` where supported.
• QuickBooks mutation tools are hidden by default. Exposing them requires explicit operator configuration and does not replace approval requirements for money movement or production accounting changes.
• Amazon SP-API credentials belong in `HERMES_HOME/mcp-tokens/amazon-sp-api/credentials.json`; keep the directory and file at modes `0700` and `0600` where supported.
• Amazon mutation tools must remain disabled unless listing changes or buyer review solicitations are intentionally needed and separately approved.
• Profiles in one Hermes deployment are not a security boundary unless the deployment provides separate operating-system isolation.
• The Agent Messaging plugin assumes every participating profile is inside one trusted deployment.
• Slack manifests are templates only and must never contain live app IDs or tokens.

The Google Workspace MCP sanitizes bearer tokens from surfaced Google API errors. The QuickBooks Online MCP validates OAuth state on a loopback-only callback, never logs its authorization-code query string, removes upstream response bodies from upload-error logs, and stores rotated refresh tokens with restrictive permissions. The Amazon SP-API MCP sanitizes SDK errors, omits Restricted Data Token and buyer-address tools, validates signed report download hosts, suppresses signed URLs, limits downloaded report sizes, and keeps mutation tools disabled by default. Secret-bearing files use atomic writes and restrictive permissions where supported.
