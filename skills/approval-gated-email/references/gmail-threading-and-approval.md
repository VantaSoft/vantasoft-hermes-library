# Gmail Threading and Approval

## Durable Rule

A matching subject does not make a message a reply. Gmail associates replies through the original message relationship and reply headers. A tool that creates a fresh draft without an original message reference should be treated as creating a new message.

## Safe Reply Sequence

1. Read the original inbound message and retain its account, `messageId`, `threadId`, sender, To, and Cc.
2. Show the complete proposed reply in the same user-facing conversation.
3. Wait for explicit approval of that reply and participant list.
4. Call `gmail_reply` on the retained original `messageId`.
5. Preserve the original participants unless the approved proposal narrows them.
6. Compare the returned thread ID with the original when both are available.

The copy displayed in the user-facing conversation is the approval artifact. A provider-side draft is not required for this flow.

## Provider-Side Drafts

Under the current Google Workspace MCP contract, `gmail_create_draft` creates a fresh message and does not accept the original message ID. Use it for new-message drafts, not as a reliable reply-draft mechanism.

`gmail_send_draft` sends a draft as-is. Do not use it for an arbitrary pre-existing draft unless its exact recipients, subject, body, and attachments have been verified and approved.

## Recovery After an Unthreaded Send

Gmail cannot retroactively attach a sent standalone message to an earlier thread. Do not silently resend. Explain the mismatch and obtain explicit approval before sending a duplicate as a proper reply.
