# Shopify Admin MCP

A portable MCP server for Shopify merchant administration. It uses Shopify's official Admin API client, keeps credentials outside the source checkout, supports multiple stores, and exposes a curated GraphQL tool catalog with mutations disabled by default.

## Why this implementation

Shopify's official Dev MCP helps developers search documentation and validate API code, but it does not connect an AI client to a merchant's Admin API. Community Admin MCP servers were also reviewed. The most visible recent candidate had inconsistent repository attribution, a suspicious `ioredis-xyz` dependency, limited non-tool tests, and high-impact mutations enabled by default. Another broad npm package had lost its source repository, while older candidates used obsolete API versions and package-structure tests.

This server therefore uses Shopify's official [`@shopify/admin-api-client`](https://github.com/Shopify/shopify-app-js/tree/main/packages/api-clients/admin-api-client) directly. See [`THIRD_PARTY.md`](THIRD_PARTY.md) for provenance and the selection record.

## Coverage

The default catalog contains 22 tools:

• Store identity, domain, currency, timezone, and plan
• Products, variants, collections, pricing, media, and inventory summaries
• Orders and fulfillment-order readiness without billing or shipping addresses
• Customer summaries, plus an explicit single-customer contact tool
• Inventory items, quantities by location, and locations
• Draft orders
• Metafields and metafield definitions
• Webhook topics without delivery destinations, publications, Markets, and price lists

Setting `SHOPIFY_ENABLE_MUTATIONS=true` adds six tools:

• Create products in `DRAFT` status
• Update products
• Set inventory with required compare-and-set quantities
• Add tags
• Remove tags
• Set metafields

The server intentionally does not expose arbitrary GraphQL, product/customer deletion, refunds, order cancellation, order payment, fulfillment creation, draft-order completion, discounts, or webhook changes.

## Requirements

• Node.js 20 or newer
• A Shopify app installed on each store
• Required Admin GraphQL API scopes
• Either an Admin API access token or Dev Dashboard client credentials

Grant only the scopes required for the tools you intend to use. Typical read scopes include products, orders, customers, inventory, locations, fulfillments, draft orders, metafields, markets, and price lists. The six optional mutations require corresponding write scopes.

## Install and build

```bash
cd mcps/shopify-admin
npm ci
npm test
```

### Install from the VantaSoft library

The component includes [`mcp-install.json`](mcp-install.json) for the deterministic installer bundled with the `install-vantasoft-mcp` skill. After installing that skill from the VantaSoft tap, preview and install into the active profile with:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/install-vantasoft-mcp/scripts/install_mcp.py" \
  shopify-admin \
  --hermes-home "${HERMES_HOME:-$HOME/.hermes}" \
  --ref main \
  --dry-run
```

Remove `--dry-run` after reviewing the plan. The installer downloads only this MCP subdirectory, builds, tests, lints, and audits it, installs it under `HERMES_HOME/mcp-installs/shopify-admin`, writes the Hermes MCP configuration, and creates the credential template only when it does not already exist. Mutations remain disabled.

## Credentials

Credentials are loaded from the first applicable location:

• `SHOPIFY_CREDENTIALS_FILE`, when explicitly set
• `$HERMES_HOME/mcp-tokens/shopify-admin/credentials.json`
• `~/.config/vantasoft-mcps/shopify-admin/credentials.json` outside Hermes

Create a profile-local credential file:

```bash
mkdir -p "$HERMES_HOME/mcp-tokens/shopify-admin"
cp credentials.example.json \
  "$HERMES_HOME/mcp-tokens/shopify-admin/credentials.json"
chmod 700 "$HERMES_HOME/mcp-tokens/shopify-admin"
chmod 600 "$HERMES_HOME/mcp-tokens/shopify-admin/credentials.json"
```

### Static Admin API token

```json
{
  "defaultStore": "primary",
  "stores": {
    "primary": {
      "shopDomain": "your-store.myshopify.com",
      "accessToken": "YOUR_SHOPIFY_ADMIN_ACCESS_TOKEN",
      "apiVersion": "2026-07"
    }
  }
}
```

### Dev Dashboard client credentials

For Shopify apps that support the client-credentials grant:

```json
{
  "defaultStore": "primary",
  "stores": {
    "primary": {
      "shopDomain": "your-store.myshopify.com",
      "clientId": "YOUR_SHOPIFY_CLIENT_ID",
      "clientSecret": "YOUR_SHOPIFY_CLIENT_SECRET",
      "apiVersion": "2026-07"
    }
  }
}
```

Client-credentials access tokens are cached only in process memory and refreshed before expiry. They are never written to disk or included in logs.

Add more entries under `stores` for additional Shopify stores. Every tool accepts an optional `store`; omitting it uses `defaultStore`.

Store domains must be exact `*.myshopify.com` hostnames. Arbitrary API hosts are rejected to prevent credential forwarding or server-side request forgery.

## Hermes configuration

```yaml
mcp_servers:
  shopify_admin:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/shopify-admin/dist/index.js
```

Hermes supplies `HERMES_HOME`, so each profile resolves its own credentials. Other MCP clients can set `SHOPIFY_CREDENTIALS_FILE` or use the portable default path.

## Mutation controls

The server is read-only by default. Mutation tools are not registered unless the process has:

```bash
SHOPIFY_ENABLE_MUTATIONS=true
```

This opt-in only exposes the six limited tools. It does not replace approval requirements for publishing products, changing inventory, removing tags, or replacing metafields.

All mutation responses are checked for Shopify `userErrors`. Merchant-supplied values and Shopify error messages are not copied into surfaced errors; only affected field paths are retained.

## Privacy and security

• List-customer results omit email, phone, and addresses.
• The explicit `shopify_get_customer` tool includes email and phone but still omits addresses.
• Order tools omit shipping and billing addresses.
• SDK errors are reduced to status, retryability, and safe request identifiers.
• Access tokens, client secrets, raw GraphQL errors, response bodies, and response headers are never surfaced.
• The official client retries abandoned, throttled, and unavailable requests up to three times.
• GraphQL query-cost data is returned when Shopify supplies it so callers can monitor throttling.

Treat all returned order, customer, sales, and inventory data as confidential merchant information.

## Validation

```bash
npm test
npm run lint
npm audit --audit-level=high
```

The suite verifies credential isolation and permissions, static and client-credentials authentication, token caching, domain restrictions, error redaction, data-minimizing GraphQL documents, official-client request mapping, mutation gating, compare-and-set inventory safety, and real MCP stdio startup.

All 27 GraphQL operations were also validated against Shopify's official Admin GraphQL `2026-07` schema during integration. Smoke tests use nonfunctional placeholder credentials and do not call Shopify.

A live development store is still required to verify app scopes, installation state, real merchant data shapes, and production mutation behavior.

## License

MIT. Shopify's official Admin API client is also MIT licensed. See [`THIRD_PARTY.md`](THIRD_PARTY.md).
