# Compatibility

The plugin is maintained and tested with the VantaSoft Hermes Agent runtime. The fork may bundle a pinned copy, while compatible deployments can install this directory from the VantaSoft plugin catalog. It has no independent wheel or package entry point.

The plugin uses Hermes profile, process-registry, gateway session-context, and session-database APIs. It checks the required runtime surface during registration and fails with a clear compatibility error when that surface is unavailable.

When `HERMES_CODEX_AUTH_FILE` is configured, the runtime must expose `hermes_constants.get_codex_auth_file_path()` and return that exact configured path. The plugin preserves the path through both narrow peer-worker environment boundaries. It passes the path only, never credential contents.

The tracked worker requires a POSIX-compatible `env` executable with `env -i`. Environments without it fail closed before a job file or child process is created.
