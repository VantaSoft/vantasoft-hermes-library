# Third-party software

This MCP uses Shopify's official Admin API client:

• Project: [`Shopify/shopify-app-js`](https://github.com/Shopify/shopify-app-js/tree/main/packages/api-clients/admin-api-client)
• Package: `@shopify/admin-api-client`
• Pinned version: `1.1.2`
• License: MIT

## MCP candidate evaluation

The Shopify Dev MCP is an official development and schema-assistance server, not a merchant Admin API server. Community Admin MCP candidates were also reviewed. The most visible recent candidate had inconsistent repository attribution, a suspicious `ioredis-xyz` dependency, limited non-tool tests, and exposed high-impact mutations by default. Another broad npm package's source repository had been deleted. Older candidates used obsolete API versions and had only package-structure tests.

This implementation therefore uses Shopify's official lightweight Admin API client directly while keeping the MCP transport and curated tool layer portable.
