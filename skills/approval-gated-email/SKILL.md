---
name: approval-gated-email
description: Draft, review, and send new email, replies, forwards, or provider-side drafts only after explicit human approval. Use when an agent operates Gmail through the Google Workspace MCP and must preserve thread context, recipients, attachments, account selection, and a clear approval boundary.
version: 1.0.0
license: MIT
metadata:
  hermes:
    tags: [email, gmail, approval, safety, threading, google-workspace]
    category: email
---

# Approval-Gated Email

Prepare email actions in the originating conversation, obtain explicit approval for the exact message, and only then write or send through the configured Google Workspace account.

## When to Use

Use this skill when the user asks to:

• write or send a new email;
• reply to an existing Gmail message or thread;
• forward a message;
• create a provider-side Gmail draft;
• send a previously prepared draft whose contents can be verified.

Reading and searching mail to establish context is allowed before approval. Sending, replying, forwarding, creating a provider-side draft, deleting a draft, or sending a draft is a mailbox mutation and remains approval-gated.

## Core Contract

1. Treat the user's request as permission to prepare the action, not permission to execute it.
2. Read the original message or thread when the request is a reply or forward.
3. Show the complete proposed action in the same user-facing conversation where the request arrived.
4. Wait for explicit approval of that exact action.
5. Execute once, inspect the real tool result, and report the outcome briefly.

Clear approval includes phrases such as `send`, `send it`, `create the draft`, or another unambiguous instruction referring to the displayed proposal. Silence, a general standing preference, or the original request is not approval.

If the recipient list, subject, body, attachment set, source account, action type, or referenced message changes after approval, show the revised proposal and obtain approval again.

## Resolve the Source Before Drafting

### Replies and forwards

Retain all of the following from the original message:

• Google Workspace account;
• `messageId`;
• `threadId`;
• sender;
• original To and Cc participants;
• subject;
• attachment context when relevant.

Use `gmail_read` on the original `messageId`. Do not reconstruct a reply from a matching subject or from quoted text in another message.

### New messages

Resolve the intended account and recipient addresses before presenting the draft. Search sent mail or another user-provided source when an address is missing. Do not guess an address or silently choose among multiple accounts when the choice affects the sender identity.

### Attachments

List every proposed attachment in the approval artifact, including its filename and whether it comes from a Drive file, local path, or generated content. Confirm that each referenced file exists before execution. A changed or additional attachment requires renewed approval.

## Present the Approval Artifact

Show the proposal in this shape:

```text
Action: Send | Reply | Forward | Create Gmail draft | Send Gmail draft
Account: <configured account>
To: <recipients>
Cc: <recipients or none>
Bcc: <recipients or none>
Subject: <subject>
Attachments: <filenames or none>

<complete plain-text body or forwarding note>

Reply "send" to execute this exact action, or tell me what to change.
```

For replies, identify the original sender and subject so the user can see which thread will receive the response. For forwards, identify the original message and show the optional prefix note. Do not paste an entire sensitive thread when a short identifier is enough.

## Execute the Approved Action

### New email

After approval, call `gmail_send` with the approved account, recipients, subject, body, and attachments.

### Reply

After approval, call `gmail_reply` on the retained original `messageId`.

Preserve the original thread participants by default with `replyAll=true`. Use `replyAll=false` only when the approval artifact clearly shows that the reply is limited to the sender. Extra Cc recipients must appear in the approved proposal.

Do not use `gmail_create_draft` followed by `gmail_send_draft` as a substitute for a reply. Under the current tool contract, a fresh draft does not carry the original message relationship needed for reliable reply threading. See [Gmail threading and approval](references/gmail-threading-and-approval.md).

If the message being replied to was sent by the authenticated account, a sender-only reply can address the user's own mailbox. Preserve the intended recipients with reply-all or use a fresh `gmail_send` only when the proposal explicitly shows that action.

### Forward

After approval, call `gmail_forward` with the retained original `messageId`, the approved recipients, optional prefix note, and attachments. The approval artifact must make clear which original message will be forwarded.

### Create a provider-side draft

After approval, call `gmail_create_draft` for a fresh message. Report the returned draft ID. Do not imply that the draft was sent.

### Send a provider-side draft

Call `gmail_send_draft` only when the exact draft contents and recipients were displayed and approved in the current conversation, or when another trusted read path verified them after the user's request. The current Google Workspace MCP cannot read an arbitrary draft by draft ID, so do not send an unverified pre-existing draft blindly.

## Verify and Report

Inspect the tool response. For replies, compare the returned `threadId` with the retained original thread when both are available. If they differ, report the mismatch and stop. Do not send a corrective duplicate without new approval.

A normal completion message should be brief, for example:

```text
Sent to alex@example.com.
```

Include a message ID, thread ID, or other technical detail only when it helps the user recover or continue the workflow.

## Failure and Recovery Rules

• If execution fails before the provider confirms success, report the error and whether retrying could duplicate the action.
• If success is ambiguous, inspect the mailbox or thread before retrying.
• If a standalone message was sent instead of a reply, Gmail cannot retroactively attach it to the earlier thread. Explain the mismatch and obtain new approval before sending anything else.
• Never expose OAuth tokens, credentials, private attachment contents, or unrelated thread content in the approval artifact or completion message.
• Never convert a send request into a draft-only action, or a draft request into a send, without showing the changed action and receiving approval.
