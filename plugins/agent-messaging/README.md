# Agent Messaging Plugin

Hermes-native peer-agent messaging maintained in the public VantaSoft plugin catalog. The VantaSoft Hermes Agent fork can bundle a pinned copy for out-of-the-box fleet deployments.

The `agent-messaging` directory plugin lets profiles in one trusted Hermes installation discover each other, start tracked full-profile child runs, deliver explicit progress and final replies to the initiating session, and resume earlier peer conversations.

## Tools

• `list_agents`: list available Hermes profiles and gateway status.
• `agent_status`: inspect one profile.
• `message_agent`: start an asynchronous tracked run in another profile.
• `agent_reply`: deliver an acknowledgment, progress update, blocker, error, or final result to the initiating session.

The plugin adds no network listener, external telemetry, Slack mirroring, or host restart controls.

## Operating model

Treat profiles as peer specialists with explicit ownership boundaries, not interchangeable hidden workers. Route clear domain work directly to the matching specialist and use a coordinator for ambiguous, cross-domain, or priority-sensitive work.

Use `message_agent` for bounded peer requests. Use a durable task board such as Hermes Kanban for dependencies, retries, and work that must survive restarts. Keep requests and replies terse, include the concrete result or precise blocker, avoid conversational back-and-forth after the dependency is resolved, and never include secret values.

## Requirements

• The containing VantaSoft Hermes Agent runtime.
• Python 3.11 through 3.13.
• A POSIX-compatible `env` executable with `env -i` support. The plugin fails closed when it cannot create a clean worker environment.
• Two or more profiles under one Hermes data root.
• The plugin enabled for every profile that sends or receives peer requests.

The plugin is tested against a pinned compatible VantaSoft Hermes Agent revision. See [COMPATIBILITY.md](COMPATIBILITY.md) for the runtime contracts it checks.

## Install or enable the plugin

The VantaSoft fork already discovers its bundled copy. For another compatible Hermes checkout, install this directory from the catalog:

```bash
hermes plugins install VantaSoft/vantasoft-hermes-plugins/plugins/agent-messaging --enable
```

Hermes currently cannot update a plugin installed from a repository subdirectory because the subdirectory install does not retain Git metadata. Until that Hermes limitation is fixed, update with a force reinstall:

```bash
hermes plugins install VantaSoft/vantasoft-hermes-plugins/plugins/agent-messaging --force --enable
```

Enable it in each participating profile:

```yaml
plugins:
  enabled:
    - agent-messaging
  entries:
    agent-messaging:
      allow_tool_override: false

platform_toolsets:
  slack:
    - agent_messaging
  cli:
    - agent_messaging
```

Restart the relevant gateways after enabling the plugin or changing its configuration.

## Verify registration

```bash
hermes --profile default plugins list --plain
```

The output should show the `agent-messaging` plugin as enabled. In a
Hermes session, `/plugins` should show four registered tools.

## How delivery works

1. `message_agent` validates the target profile and initiating session.
2. It writes a private, short-lived job envelope into the target profile.
3. Hermes's native process registry starts a tracked worker with no request content in its process arguments.
4. The worker passes the request to an in-process Hermes launcher over stdin using a narrow environment; the target profile then loads its own `.env`.
5. The target calls `agent_reply` for acknowledgments, progress, blockers, errors, and the final result.
6. Replies are appended idempotently to the exact initiating Hermes session.
7. Hermes's native completion watcher resumes the parent session after the child exits.
8. A later `message_agent` call can pass `reply_to` to resume the target conversation.

Normal child stdout is retained in the target profile's private worker log and is never used as the peer reply. This prevents tool traces and incomplete scratch output from being mistaken for a completed result.

When the host sets `HERMES_CODEX_AUTH_FILE` to a non-empty absolute path, the plugin preserves that deployment-level path through both worker environment boundaries. VantaSoft Hermes Agent keeps the process-level value authoritative over target profile `.env` files, so targets continue using the canonical shared auth store instead of falling back to profile-local `auth.json` files. The plugin passes the path only, never credential contents.

## Example

From one profile:

```text
Use message_agent with:
  agent: research
  message: Compare the two proposed vendors and return a recommendation.
```

The target profile must finish with an explicit tool call equivalent to:

```text
agent_reply(
  message_id="msg_...",
  kind="final",
  message="Recommendation: ...",
)
```

To continue the same target context, call `message_agent` again with the previous `conversation_id` as `reply_to`.

## Security model

All participating profiles are inside one trust boundary. A target run uses the target profile's own identity, tools, credentials, memory, and workspace. Do not co-locate unrelated customers and treat profiles as a security boundary.

Job envelopes use mode `0600` where supported and are deleted when the worker reads them. Successful-run diagnostic logs are deleted automatically. Failure logs remain under the target profile's `tmp/agent-messaging/` directory, may contain sensitive target output, and are capped at 1 MiB each, 10 files, and 7 days.

See [SECURITY.md](SECURITY.md) for disclosure and trust-boundary details.

## Development

```bash
python -m pytest -q tests/plugins/agent_messaging
python -m ruff check plugins/agent-messaging tests/plugins/agent_messaging
```

## License

MIT. See [LICENSE](LICENSE).
