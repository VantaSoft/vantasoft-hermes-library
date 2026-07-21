# Amazon Selling Partner API MCP

A portable MCP server for Amazon Seller Central and FBA operations. It uses Amazon's official JavaScript Selling Partner API SDK, keeps credentials outside the source checkout, supports multiple seller stores, and exposes 27 read/report tools by default.

## Why this implementation

The available community SP-API MCP servers reviewed in July 2026 were either unlicensed, minimally tested, incomplete for FBA workflows, or dependent on a hosted third-party service. This server therefore uses Amazon's maintained SDK directly instead of putting Seller Central credentials through an unknown intermediary.

See [`THIRD_PARTY.md`](THIRD_PARTY.md) for the SDK version, license, and candidate-selection record.

## Coverage

• Seller account and marketplace participation
• FBA inventory summaries and eligibility
• Orders and order items, without restricted buyer-address tools
• Amazon catalog and seller listing search
• Competitive pricing and offers
• Financial events
• Report creation, status, metadata, and protected document download
• FBA inbound plans, shipments, and plan items
• Fee estimates
• Review-solicitation eligibility
• Optional listing patches and standardized review solicitations

The default catalog contains 27 tools. Setting `SP_API_ENABLE_MUTATIONS=true` adds two clearly labeled mutation tools. No full-listing delete, buyer-address, buyer-info, restricted-data-token, inbound-plan confirmation, or shipment-confirmation tool is exposed.

## Requirements

• Node.js 20 or newer
• An Amazon Selling Partner API application
• Login with Amazon client ID and client secret
• A seller authorization refresh token
• Seller ID, region, and default marketplace ID

Start with Amazon's [SP-API registration overview](https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview) and [application registration guide](https://developer-docs.amazon.com/sp-api/docs/registering-your-application). The Amazon application must have the roles required by the operations you plan to use.

## Install and build

```bash
cd mcps/amazon-sp-api
npm ci
npm test
```

## Credentials

Credentials are loaded from the first applicable location:

• `SP_API_CREDENTIALS_FILE`, when explicitly set
• `$HERMES_HOME/mcp-tokens/amazon-sp-api/credentials.json`
• `~/.config/vantasoft-mcps/amazon-sp-api/credentials.json` outside Hermes

Create the profile-local file:

```bash
mkdir -p "$HERMES_HOME/mcp-tokens/amazon-sp-api"
cp credentials.example.json \
  "$HERMES_HOME/mcp-tokens/amazon-sp-api/credentials.json"
chmod 700 "$HERMES_HOME/mcp-tokens/amazon-sp-api"
chmod 600 "$HERMES_HOME/mcp-tokens/amazon-sp-api/credentials.json"
```

Edit the copied file with real credentials. Never edit or commit `credentials.example.json` with live values.

```json
{
  "defaultStore": "primary",
  "stores": {
    "primary": {
      "clientId": "YOUR_LWA_CLIENT_ID",
      "clientSecret": "YOUR_LWA_CLIENT_SECRET",
      "refreshToken": "YOUR_SP_API_REFRESH_TOKEN",
      "sellerId": "YOUR_SELLER_ID",
      "region": "NA",
      "marketplaceId": "ATVPDKIKX0DER",
      "sandbox": false
    }
  }
}
```

Add additional entries under `stores` for other seller accounts or SP-API regions. Tool calls accept an optional `store`; omitting it uses `defaultStore`.

Supported regions:

• `NA`: North America endpoint
• `EU`: Europe endpoint
• `FE`: Far East endpoint

Set `sandbox` to `true` only for Amazon's SP-API sandbox. The server derives endpoints from the region and sandbox flag. It does not accept arbitrary endpoint URLs.

## Hermes configuration

```yaml
mcp_servers:
  amazon_sp_api:
    command: node
    args:
      - /absolute/path/to/vantasoft-hermes-library/mcps/amazon-sp-api/dist/index.js
```

Hermes supplies `HERMES_HOME` to the process, so each profile resolves its own credential file. For another MCP client, set `SP_API_CREDENTIALS_FILE` explicitly or use the non-Hermes default path.

## Mutation controls

The server is read-only by default. Listing changes and customer review solicitations are not registered unless the process has:

```bash
SP_API_ENABLE_MUTATIONS=true
```

Enabling the catalog does not authorize a specific business action. The caller should still obtain explicit approval before invoking:

• `spapi_patch_listing`
• `spapi_send_review_solicitation`

The listing tool accepts only top-level `/attributes/...` patch paths. The server intentionally does not expose listing deletion or operational FBA confirmation actions that can create charges or irreversible shipment decisions.

## Report safety

`spapi_download_report_document` does not return Amazon's signed document URL. It:

• accepts only HTTPS URLs hosted under `amazonaws.com`
• refuses redirects
• applies a 30-second timeout
• limits compressed and decompressed output to 1 MB by default
• permits a caller-selected maximum up to 5 MB
• decompresses Amazon `GZIP` reports locally

Large reports should be processed through a separate controlled data pipeline rather than sent through MCP context.

## Data and privacy limitations

This MCP does not request Restricted Data Tokens and does not expose buyer-address or buyer-info operations. Some order fields can still contain sensitive commercial information. Treat all tool output as confidential seller data.

Errors are sanitized before they reach the MCP client. Raw SDK response bodies, authorization headers, refresh tokens, signed report URLs, and credential values are never included in surfaced errors.

## Validation

```bash
npm test
npm run lint
npm audit --audit-level=high
```

The test suite verifies configuration isolation, credential-file permissions, error redaction, SDK operation availability, request mapping, signed report URL protection, gzip report handling, mutation gating, and real MCP stdio startup. Smoke tests use nonfunctional placeholder credentials and make no Amazon request.

A live Seller Central account is still required to verify application roles, authorization, regional marketplace access, and production response behavior.

## License

VantaSoft integration code is MIT licensed. Amazon's official SDK is Apache 2.0 licensed and remains an npm dependency. See [`THIRD_PARTY.md`](THIRD_PARTY.md).
