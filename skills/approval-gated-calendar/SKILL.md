---
name: approval-gated-calendar
description: Draft, review, and create, update, or delete Google Calendar events only after explicit human approval. Use when an agent operates Calendar through the Google Workspace MCP and must resolve attendees, account, timezone, availability, notifications, conferencing, and duplicate events safely.
version: 1.0.0
license: MIT
metadata:
  hermes:
    tags: [calendar, google-calendar, approval, scheduling, safety, google-workspace]
    category: productivity
---

# Approval-Gated Calendar

Prepare calendar mutations in the originating conversation, obtain explicit approval for the exact event action, and only then create, update, or delete the event.

## When to Use

Use this skill when the user asks to:

• create a meeting or personal calendar block;
• update an event's title, time, description, or location;
• reschedule a meeting;
• delete or reconcile a duplicate event;
• add Google Meet conferencing during event creation.

Read-only event listing, calendar discovery, and free/busy checks are allowed before approval. Creating, updating, or deleting an event remains approval-gated.

## Core Contract

1. Treat the user's request as permission to prepare the calendar action, not permission to execute it.
2. Resolve the exact calendar account, event, attendees, time, timezone, notifications, and location before seeking approval.
3. Show the complete proposal in the same user-facing conversation where the request arrived.
4. Wait for explicit approval of that exact proposal.
5. Execute once, verify against the real calendar response, and report the outcome briefly.

Clear approval includes phrases such as `create it`, `send the invite`, `update it`, `delete it`, or another unambiguous instruction referring to the displayed proposal.

Any material change after approval requires a new proposal. Material changes include the action type, account, calendar, event ID, title, date, start or end time, timezone, attendees, notification behavior, location, description, or conferencing choice.

## Resolve the Event Before Drafting

Collect or derive:

• action: create, update, or delete;
• configured Google Workspace account;
• calendar ID, normally `primary` unless the user selected another calendar;
• existing event ID for updates or deletions;
• title;
• start and end date-time;
• IANA timezone, such as `America/Los_Angeles`;
• attendee email addresses;
• location or virtual-meeting choice;
• description;
• whether attendees should receive notifications.

Do not guess an attendee address. Look it up from a user-provided email thread, prior event, or another trusted source. Ask when the identity remains ambiguous.

Do not guess the owning account when multiple configured accounts could plausibly host the event. The account controls calendar ownership and invitation identity.

## Time and Availability

Use the system clock or another date tool for current dates and timezone calculations. Do not infer today's date from conversation text or hardcode daylight-saving offsets.

Represent start and end as ISO 8601 date-times with an explicit offset, and also pass the IANA `timeZone` when the tool supports it.

Before proposing a meeting time:

1. Use `gcal_free_busy` for the relevant calendar and time window when availability matters.
2. Use `gcal_list_events` around the proposed window to identify likely duplicates or adjacent commitments when needed.
3. Surface conflicts instead of silently overriding them.
4. If availability cannot be checked, say so in the proposal rather than claiming the time is free.

A free/busy result is advisory. The create or update result is the source of truth for whether the mutation succeeded.

## Present the Approval Artifact

Show the proposal in this shape:

```text
Action: Create | Update | Delete
Account: <configured account>
Calendar: <calendar ID>
Event: <existing event ID for update/delete, otherwise new>
Title: <title>
When: <day, date, start-end, timezone>
Attendees: <addresses or none>
Location: <physical location, Google Meet, or none>
Notifications: all | external only | none
Description: <description or none>
Conflicts: <none found, details, or not checked>

Reply with the action, such as "create it", to execute this exact proposal, or tell me what to change.
```

For deletion, identify the existing event by ID, title, date, owner account, and calendar. Do not rely on title alone.

## Execute the Approved Action

### Create

Call `gcal_create_event` with the approved values.

• Use `addMeet=true` only when the proposal includes Google Meet.
• Use `sendUpdates="all"` when the approved action should email invitations to attendees.
• Use `sendUpdates="none"` for a personal block with no attendee notification.
• Do not omit `sendUpdates` when the approval artifact promises invitations. The current MCP default is no email.

### Update

Call `gcal_update_event` with the retained event ID, calendar ID, account, and only the approved changed fields.

The current public Google Workspace MCP update tool supports title, description, location, start, end, and timezone. It does not expose attendee-list changes, notification controls, or adding Meet conferencing on an existing event. If the requested update needs an unsupported field, report the limitation. Do not delete and recreate the event unless that replacement action, including its cancellation and invitation effects, is separately displayed and approved.

### Delete

Call `gcal_delete_event` with the retained event ID, calendar ID, and account only after deletion approval.

The current delete tool does not expose a notification option. Do not promise that attendees will or will not receive cancellation mail unless the provider result or another verified source confirms it.

## Duplicate-Event Reconciliation

When two events appear to represent the same meeting:

1. Read both events and identify their owners, attendees, times, locations, conferencing links, and event IDs.
2. Present the concrete choices, such as keep the externally owned event and delete the local duplicate, or keep the local event and leave the other untouched.
3. Wait for approval of the exact deletion or update.
4. Mutate only the selected event.

Never delete a likely duplicate merely because titles and times are similar.

## Verify and Report

Inspect the tool response and retain returned identifiers and links. When practical, use `gcal_list_events` around the event time to confirm the event appears with the approved title and schedule after creation or update.

A normal completion message should be brief, for example:

```text
Invite created for Tuesday at 10:00 AM Pacific. Meet: <verified link>
```

Include the event ID or calendar link when useful for recovery or follow-up. Never invent a Meet link, event URL, event ID, invitation status, or attendee-notification result.

## Failure and Recovery Rules

• If execution fails before the provider confirms success, report the exact non-secret error and whether retrying could create a duplicate.
• If success is ambiguous, list the target time window before retrying.
• Do not retry a create blindly after a timeout.
• Do not move a conflicting event, force a time, or select another calendar without renewed approval.
• Never expose OAuth credentials, private event details unrelated to the request, or attendee information beyond what the user needs to approve the action.
