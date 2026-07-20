---
name: new-agent-setup
description: Create minimal zero-skill VantaSoft agent profiles.
version: 1.9.0
author: Forrest Zhang (VantaSoft) and Hermes Agent
license: MIT
metadata:
  hermes:
    category: autonomous-ai-agents
    tags: [profiles, multi-agent, vantasoft]
    related_skills: [hermes-agent]
    homepage: https://github.com/VantaSoft/vantasoft-hermes-library/tree/main/skills/new-agent-setup
---

# New Agent Setup Skill

Create a named VantaSoft Hermes profile with a minimal reviewed configuration and no bundled skills. This workflow configures the profile, identity, tools, credentials, and gateway without cloning another agent's state.

The operator profile may use this skill. Target specialist profiles still start with zero skills unless the deployment owner explicitly approves additions.

## When to Use

Use this skill when:

• creating a new visible specialist or operator profile;
• replacing an agent while preserving a role boundary;
• rebuilding a profile that inherited excessive config or skills;
• checking whether a profile follows the VantaSoft baseline.

Do not use it to clone memories, sessions, tokens, or customer state between profiles.

## Prerequisites

Before asking the user anything, inspect the current deployment context without reading credential values. Reuse facts already available from `HERMES_HOME`, the operator profile, existing shared context, profile registry, environment variable names, and deployment documentation. Do not ask the user to repeat facts that are already known or safely discoverable.

For every item not already supplied, ask one concise intake containing exactly these human-facing fields:

• **Name**: the agent's visible human name;
• **Title**: the agent's concise professional title;
• **Responsibilities**: its ownership boundary, recurring duties, supported company or customer scope, and escalation triggers;
• **Integrations**: required messaging platforms such as Slack, peer messaging, cron, MCP servers, and any other external systems, with `none` allowed.

Do not ask the user to invent a filesystem profile name. Derive it from **Name** by Unicode-normalizing and transliterating to ASCII when unambiguous, lowercasing, replacing every run outside `[a-z0-9]` with `-`, collapsing repeated separators, trimming separators, and limiting the result to 64 characters. Validate the result with Hermes's native `normalize_profile_name` and `validate_profile_name` behavior before creation. Preserve the original human-facing Name in `SOUL.md`.

Show the inferred mapping, for example `Kyle Senpai → kyle-senpai`, but do not request confirmation when it is valid and unused. Ask one concise profile-ID resolution question only when transliteration is ambiguous or empty, the inferred ID is reserved or invalid, truncation would be unclear, or the target directory or profile name already exists. Never silently attach a numeric suffix to resolve a collision.

Derive the fleet root from `HERMES_HOME` when it is unambiguous. Derive permitted tools from the reviewed bare-minimum template. OpenAI Codex defaults to the fleet root's shared `auth.json`; treat `HERMES_CODEX_AUTH_FILE` only as an optional deployment override.

Resolve owner, escalation, and approval rules from the deployment's existing authority context. A customer deployment is owned by its designated customer principal, not by Forrest Zhang or VantaSoft personnel by default. Never assume an owner from the public template; ask only when the deployment context does not identify the authorized customer or internal principal.

The deployment bootstrap must seed an initial fleet-level `HERMES.md` and `wiki/` scaffold before this skill runs. If `HERMES.md` still contains its one-time initialization section or unresolved placeholders, pause named-profile creation and direct the operator to complete those loaded fleet-root instructions first. Do not duplicate fleet initialization inside this skill.

The VantaSoft Hermes Agent runtime does not bundle an agent communication plugin. When peer messaging is requested, install the unbranded `agent-messaging` plugin from `VantaSoft/vantasoft-hermes-library` into every participating profile and keep all participants inside one trusted customer boundary.

Never place tokens, OAuth grants, private keys, customer data, or credential values in this skill, its template, Git, or profile `SOUL.md` files.

## How to Run

Invoke `/new-agent-setup` from an operator profile, or ask the operator agent to create a minimal profile using this skill.

The skill uses:

• `terminal` for Hermes profile and gateway commands;
• `read_file` to load the bundled template;
• `write_file` or `patch` for the target profile's non-secret files;
• `search_files` to verify that no `SKILL.md` files were installed.

Bundled paths relative to this skill:

```text
templates/bare-minimum-config.yaml
```

## Quick Reference

Create the profile from the fleet root. `<profile-id>` is the lowercase identifier inferred from the human-facing Name; the description is derived from Title and Responsibilities:

```bash
HERMES_HOME=<fleet-root> hermes profile create <profile-id> \
  --no-skills \
  --description "<title and concise responsibility summary>"
```

Install the baseline by reading the bundled template, replacing `<fleet-root>` and `<profile-name>` with the inferred profile ID, then writing it to:

```text
<fleet-root>/profiles/<profile-name>/config.yaml
```

Create the identity file at:

```text
<fleet-root>/profiles/<profile-name>/SOUL.md
```

Keep secret values only in the deployment's approved secret store or the target profile's mode-`0600` `.env`.

## Procedure

### 1. Collect the human-facing agent definition

Ask for any missing Name, Title, Responsibilities, and Integrations in one concise message. Derive supported companies or customers, expected users, ownership boundaries, and escalation triggers from Responsibilities plus the established fleet context. Ask a follow-up only when a trust boundary remains materially ambiguous.

Use a separate Hermes data root, shared Codex auth store, and writable volume for every customer deployment.

### 2. Infer and validate the lowercase profile ID

Apply the deterministic Name-to-ID rule above, then inspect existing profile names and the target directory without reading or printing credential values. Validate the inferred ID using Hermes's native profile validation before creating anything. Report the inferred mapping and proceed automatically when it is valid and unused.

Do not ask the user for a lowercase directory name, reconfirm an unambiguous fleet root, restate an established owner or escalation policy, enumerate tools already fixed by the reviewed template, or redesign the shared wiki during profile creation. The root `HERMES.md` initialization instructions must already have been completed and removed before this procedure continues.

For customer deployments, use the designated customer principal and customer-approved escalation path. For internal VantaSoft or Telvana deployments, use the principals documented in that deployment's context. If no owner or authority policy is documented, ask one concise question rather than presenting a broad intake questionnaire.

### 3. Create a blank profile

Run `hermes profile create` with `--no-skills`. Do not use `--clone`, `--clone-all`, or `--clone-from` unless the deployment owner explicitly requests state inheritance.

The command must create the `.no-bundled-skills` marker. This prevents later Hermes updates from silently populating the target with the full bundled skill library.

### 4. Apply the bare-minimum config

Read `templates/bare-minimum-config.yaml`, replace both placeholders, and write the result to the target profile.

The baseline intentionally includes:

• OpenAI Codex routing with high reasoning effort;
• an 85 percent context-compression threshold;
• a 300-second auxiliary compression timeout;
• quiet Slack-facing progress and reaction settings;
• approvals disabled for the trusted operator deployment;
• only the core file, terminal, session, memory, clarification, and delegation toolsets.

The template intentionally omits customer-specific MCP servers, Slack tokens, home channels, cron jobs, and secrets. Add only the integrations required by the profile's role.

### 5. Write a role-specific SOUL.md

Keep `SOUL.md` focused on the profile itself:

• Name, Title, and human-facing identity;
• Responsibilities and ownership boundary;
• when users should contact it directly;
• company and customer scope;
• escalation and approval rules;
• security constraints;
• concise communication style;
• optional fictional persona and avatar anchors.

Put shared fleet policy in the fleet root's `HERMES.md`, not in every profile's `SOUL.md`.

### 6. Configure credentials without copying auth state

OpenAI Codex OAuth automatically uses the fleet root's shared `auth.json` across profiles. Set `HERMES_CODEX_AUTH_FILE` only when the deployment needs a different absolute path. Do not copy an OAuth-bearing `auth.json` into each profile because rotating refresh tokens diverge.

Keep Slack and integration credentials profile-local unless the deployment architecture explicitly provides a shared secret. Never hardcode credential values in `config.yaml`.

### 7. Add only role-required integrations

Add MCP servers, cron jobs, and platform-specific tools only when the role needs them. Do not inherit broad toolsets from an operator profile.

When peer messaging is requested, install the external plugin into the target profile after writing the baseline config:

```bash
HERMES_HOME=<fleet-root>/profiles/<profile-name> hermes plugins install \
  VantaSoft/vantasoft-hermes-library/plugins/agent-messaging --enable
```

Then add `agent_messaging` only to the target platform toolsets that need peer communication. Do not enable it for profiles that do not participate in the trusted peer fleet.

For visible Slack agents, use one Slack app per profile. Prefer DMs, mentions, and thread replies. Avoid duplicating workspace slash commands across multiple bots.

When Slack is requested, install the a-la-carte `slack-app-manifest` skill into the operator profile running this workflow:

```bash
hermes skills tap add VantaSoft/vantasoft-hermes-library
hermes skills install VantaSoft/vantasoft-hermes-library/slack-app-manifest
```

Load `/slack-app-manifest` and follow that skill's canonical prompting, generation, validation, and delivery procedure. Derive the short description from Title and Responsibilities. Use an approved deployment or persona color when one is already known; otherwise accept the skill's default without adding a color question to intake. Do not use raw `hermes slack manifest` output as the final artifact.

### 8. Validate configuration

Run:

```bash
HERMES_HOME=<fleet-root> hermes --profile <profile-name> config check
HERMES_HOME=<fleet-root> hermes profile list
```

Use `search_files` in the target profile for `SKILL.md`. The result must be empty unless skills were explicitly approved.

Confirm the template values resolve as intended, especially:

```text
agent.reasoning_effort = xhigh
compression.threshold = 0.85
auxiliary.compression.timeout = 300
display.tool_progress = off
plugins is absent unless an explicitly requested integration installs one
```

### 9. Start and smoke-test the gateway

Start or restart the target gateway through the deployment's normal supervisor. Verify gateway supervision and platform connectivity separately.

Run a safe identity smoke test and confirm the response matches `SOUL.md`. If peer messaging is enabled, verify the `agent_messaging` toolset exposes the Agent Messaging tools without sending customer data.

## Pitfalls

• Creating a profile without `--no-skills`, then deleting skills manually. Updates can restore them unless the marker exists.
• Cloning another profile and unintentionally copying Slack tokens, OAuth state, memories, sessions, or role-specific tools.
• Treating the bare-minimum template as customer-complete. It deliberately omits customer integrations and secrets.
• Duplicating fleet initialization in this skill instead of following and then removing the one-time instructions in the seeded root `HERMES.md`.
• Asking the user to repeat the fleet root, owner, auth-store path, tools, or policies already available in deployment context.
• Assuming Forrest Zhang or VantaSoft owns a customer deployment instead of using the designated customer principal.
• Adding every available tool or MCP server instead of following the profile's role.
• Sharing one Hermes root or Codex auth store across unrelated customers.
• Assuming a supervised gateway proves Slack or another platform authenticated successfully.
• Committing rendered customer configs, `.env` files, auth stores, logs, sessions, or private deployment manifests to the public fork.

## Verification

Before declaring the profile ready, confirm:

• the profile exists under the intended fleet root;
• the fleet root has rendered shared context and wiki files with no unresolved placeholders;
• `.no-bundled-skills` exists;
• no unapproved `SKILL.md` files are present;
• the rendered config parses and `hermes config check` passes;
• the 300-second compression timeout is present;
• `SOUL.md` matches the assigned role and scope;
• only approved tools, plugins, MCP servers, and cron jobs are enabled;
• secret files have restrictive permissions and no secrets entered Git;
• the gateway is supervised and the intended platform is connected;
• identity and peer-messaging smoke tests pass.
