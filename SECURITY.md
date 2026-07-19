# Security

Report suspected vulnerabilities privately to VantaSoft before public disclosure.

## Credential handling

• Never commit OAuth client secrets, access tokens, refresh tokens, Slack tokens, signing secrets, `.env` files, customer credentials, or credential fragments.
• Google Workspace credentials belong under the active profile's `HERMES_HOME/mcp-tokens/google-workspace` directory.
• Profiles in one Hermes deployment are not a security boundary unless the deployment provides separate operating-system isolation.
• The Agent Messaging plugin assumes every participating profile is inside one trusted deployment.
• Slack manifests are templates only and must never contain live app IDs or tokens.

The Google Workspace MCP sanitizes bearer tokens from surfaced Google API errors. Secret-bearing files use atomic writes and restrictive permissions where supported.
