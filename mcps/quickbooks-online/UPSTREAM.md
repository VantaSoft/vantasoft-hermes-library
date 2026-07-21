# Upstream provenance

This component was imported from:

• Repository: [`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server)
• Upstream commit: [`099351858ee696dbbeb00dc7ca8e3a86276d86bb`](https://github.com/intuit/quickbooks-online-mcp-server/tree/099351858ee696dbbeb00dc7ca8e3a86276d86bb)
• Import date: `2026-07-21`
• Upstream copyright: `Copyright 2025 Intuit, Inc.`
• Component license: Apache License 2.0

## VantaSoft modifications

• Renamed the package for the VantaSoft library namespace.
• Moved default credential storage to the active profile's `HERMES_HOME`.
• Made create, update, and delete tools opt-in.
• Sanitized upload error logging.
• Hardened local OAuth with loopback-only binding, random-state validation, exact callback routing, and query-string log redaction.
• Updated and pinned runtime dependencies, with audited transitive overrides.
• Added Hermes stdio startup coverage and profile-path tests.
• Replaced the top-level component documentation with Hermes setup guidance.

`CHANGELOG.md`, upstream architecture documentation, source, tests, and the Apache license are retained to make future upstream comparisons and updates reviewable. The original README remains available at the pinned upstream commit linked above.
