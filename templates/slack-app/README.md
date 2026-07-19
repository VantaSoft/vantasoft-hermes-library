# Simplified Slack App Manifest

Canonical Slack app manifest for a named Hermes agent using Socket Mode and ordinary Slack messages.

This is intentionally a setup template, not a runtime Hermes plugin. It does not register tools, hooks, commands, or a platform adapter. Making it a plugin would require enabling runtime code solely to render a one-time provisioning artifact.

## Generate a manifest

```bash
python templates/slack-app/generate.py \
  --name "Markus" \
  --description "VantaSoft and Telvana engineering agent" \
  --background-color "#1a1a2e"
```

The generator writes validated JSON to stdout. To write a file explicitly:

```bash
python templates/slack-app/generate.py \
  --name "Markus" \
  --description "VantaSoft and Telvana engineering agent" \
  --write /tmp/markus-slack-manifest.json
```

Import the JSON through Slack's app-manifest flow, then store the resulting bot and app tokens only in the target Hermes profile's approved secret location.

## Design choices

• JSON rather than YAML for paste-safe Slack imports.
• No slash commands, assistant view, or agent view.
• Socket Mode enabled.
• Direct messages, mentions, public/private channel messages, and multiparty messages supported.
• File read/write scopes included for Hermes media and attachment delivery.
• Reactions scopes retained for deployments that choose to use reactions, even when the fleet disables reaction markers in Hermes configuration.
• No credentials, app IDs, signing secrets, or workspace-specific values in the template.

See [PROMPT.md](PROMPT.md) for the short generation prompt suitable for another agent or LLM.
