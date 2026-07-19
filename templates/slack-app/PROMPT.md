# Slack Manifest Generation Prompt

Generate the canonical VantaSoft Slack app manifest for this Hermes agent.

Inputs:

• Agent name: `<Agent Name>`
• Short description: `<Short Description>`
• Background color: `<Hex Color>`

Use `template.json` as the exact structural source of truth. Replace only the three placeholders above. Preserve the ordered bot scope and event lists. Do not add slash commands, assistant or agent views, `commands`, `assistant:write`, token rotation, credentials, app IDs, signing secrets, bot tokens, or app tokens.

Validate the completed manifest with `generate.py` when the script is available. Return paste-safe JSON. Never include secret values.
