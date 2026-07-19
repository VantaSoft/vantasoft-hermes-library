# Changelog

All notable changes to this project will be documented here.

The project follows [Semantic Versioning](https://semver.org/).

## [0.2.1]

### Changed

* Guide agents to use peer messaging for bounded work and a durable task board for dependencies, retries, and restart-safe handoffs.
* Require concise peer requests and concrete results or blockers without secret values or conversational filler.

## [0.2.0]

### Changed

* Move the plugin into the pinned `vantasoft-hermes-agent` fork as a bundled directory plugin.
* Remove wheel, Python entry-point, and Docker-specific installation requirements.

### Fixed

* Preserve `HERMES_CODEX_AUTH_FILE` through both narrow peer-worker environment boundaries while continuing to drop unrelated ambient credentials.
* Fail plugin registration when shared auth is configured on a Hermes runtime that ignores the canonical path.

## [0.1.0] - 2026-07-16

### Added

* Hermes profile discovery through `list_agents` and `agent_status`.
* Asynchronous, Hermes-tracked cross-profile runs through `message_agent`.
* Explicit acknowledgments, progress updates, blockers, errors, and final replies through `agent_reply`.
* Resumable peer conversations through `reply_to`.
* Narrow target environments that do not inherit unknown sender credentials.
* Stdin delivery that keeps peer request content out of process arguments.
* Automatic successful-log deletion and failure-log bounds of 1 MiB each, 10 files, and 7 days.
* Fail-closed `env -i` worker bootstrap to prevent startup-time credential inheritance.
* A 65,536-character request and reply limit.
* Git-directory and Python entry-point installation paths.
* Focused unit, packaging, and registration tests.
