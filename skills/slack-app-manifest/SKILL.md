---
name: slack-app-manifest
description: Generate a minimal Slack manifest for a Hermes agent
version: 1.0.0
metadata:
  hermes:
    tags: [slack, setup, manifest, integrations]
    category: integrations
    requires_toolsets: [terminal]
---

# Slack App Manifest

Generate the canonical minimal Slack app manifest for one named Hermes agent using Socket Mode and ordinary Slack messages.

## When to Use

Use this skill when:

• creating a Slack app for a new visible Hermes profile;
• replacing Hermes's broad default manifest with the command-free named-agent template;
• producing paste-ready JSON for Slack's app-manifest importer;
• validating that an existing generated manifest still matches the fleet contract.

Do not use it to create Slack credentials, install an app into a workspace, or store tokens. Those remain operator-controlled actions.

## Inputs

Collect or derive:

• **Name**: the human-facing agent name, 1 to 80 characters;
• **Description**: the short Slack app description, 1 to 140 characters;
• **Background color**: an approved six-digit hex color, or `#1a1a2e` when no approved color is known.

Do not add another intake question solely for the background color when the default is acceptable.

## Procedure

1. Resolve this installed skill's directory. The normal location is `${HERMES_HOME:-$HOME/.hermes}/skills/integrations/slack-app-manifest`.
2. Run the bundled [generator](scripts/generate_slack_manifest.py):

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/slack-app-manifest/scripts/generate_slack_manifest.py" \
  --name "<Agent Name>" \
  --description "<Short Description>" \
  --background-color "#1a1a2e"
```

3. To write an artifact instead of printing JSON, add:

```bash
--write /absolute/path/to/slack-manifest.json
```

4. Validate the result against the bundled [template](templates/template.json) and the contract below.
5. When the user requests paste-ready output, return only the manifest inside a fenced `json` block.
6. Keep the generated file only when the user requested a file artifact. Otherwise use a temporary path for validation and remove it afterward.

## Manifest Contract

The generated JSON must retain:

• manifest metadata version `1.1`;
• matching `display_information.name` and `features.bot_user.display_name`;
• `app_home` and `bot_user` features;
• no `slash_commands`, `assistant_view`, or `agent_view`;
• exactly 16 ordered bot scopes for mentions, messages, channel and DM discovery, files, and reactions;
• exactly five bot events: `app_mention`, `message.channels`, `message.groups`, `message.im`, and `message.mpim`;
• Socket Mode enabled;
• interactivity enabled;
• no commands, assistant scopes, assistant events, token rotation settings, tokens, app IDs, bot IDs, client secrets, signing secrets, or credentials.

## Pitfalls

• Do not use raw `hermes slack manifest` output as the final named-agent manifest. Its broader defaults can add slash commands, assistant surfaces, and unrelated scopes.
• Do not alter scopes or events unless the deployment owner explicitly changes the fleet contract.
• Do not infer or embed Slack credentials.
• Do not emit YAML. Slack's manifest importer accepts JSON or YAML, but this skill's canonical artifact is JSON.
• Do not invent a description unrelated to the agent's actual title and responsibilities.

## Verification

Run the generator and parse the output as JSON:

```bash
python3 "${HERMES_HOME:-$HOME/.hermes}/skills/integrations/slack-app-manifest/scripts/generate_slack_manifest.py" \
  --name "Manifest Test" \
  --description "Hermes manifest verification" \
  | python3 -m json.tool >/dev/null
```

Confirm that the output contains no placeholder values and satisfies every item in the manifest contract before delivery.
