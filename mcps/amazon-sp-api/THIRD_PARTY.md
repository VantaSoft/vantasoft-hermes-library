# Third-party software

This MCP server uses Amazon's official JavaScript SDK for the Selling Partner API:

• Project: [`amzn/selling-partner-api-sdk`](https://github.com/amzn/selling-partner-api-sdk)
• Package: [`@amazon-sp-api-release/amazon-sp-api-sdk-js`](https://www.npmjs.com/package/@amazon-sp-api-release/amazon-sp-api-sdk-js)
• Pinned package version: `1.9.0`
• License: Apache License 2.0

The SDK remains an npm dependency and is not copied into this repository. A copy of the upstream Apache 2.0 license is retained at [`THIRD_PARTY_LICENSES/Amazon-SP-API-SDK-LICENSE`](THIRD_PARTY_LICENSES/Amazon-SP-API-SDK-LICENSE).

## MCP candidate evaluation

The available community SP-API MCP servers reviewed in July 2026 were either unlicensed, minimally tested, incomplete for FBA workflows, or dependent on a hosted third-party service. This implementation therefore uses Amazon's maintained SDK directly rather than vendoring one of those servers.
