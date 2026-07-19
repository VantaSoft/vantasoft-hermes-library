# Security Policy

## Supported versions

Security updates ship with supported VantaSoft Hermes Agent fork releases.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for this repository.

Include the affected version, reproduction steps, impact, and any proposed remediation. VantaSoft will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Trust model

This plugin is intended for profiles inside one trusted Hermes installation. An enabled profile can ask another enabled profile to execute work with that target profile's own tools and credentials.

The plugin:

* does not provide cross-host or cross-tenant messaging;
* does not add network listeners or telemetry;
* does not forward normal child stdout to the requesting session;
* passes peer requests to the target launcher over stdin rather than process arguments;
* starts the tracked worker and target launcher with narrow environments so unknown sender credentials are not inherited;
* runs both Python stages in isolated mode so sender-controlled Python startup paths are ignored;
* stores short-lived job envelopes with mode `0600` when the host supports POSIX permissions;
* deletes successful-run diagnostic logs and caps retained failure logs at 1 MiB each, 10 files, and 7 days;
* writes explicit peer replies into the initiating Hermes session database; and
* relies on Hermes process and session APIs that may change between Hermes releases.

Do not use one Hermes installation as a security boundary between unrelated customers. Run separate customers in separate operating-system or container trust boundaries.
