import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type Attachment =
  | { driveFileId: string; filename?: string }
  | { filePath: string; filename?: string; mimeType?: string }
  | { filename: string; mimeType: string; contentBase64: string };

// Split an RFC-5322 address list ("A <a@x>, B <b@x>") on commas, while
// tolerating commas inside quoted display names ("Last, First" <x@y>).
function splitAddressList(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let buf = "";
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") depth++;
    else if (!inQuote && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && !inQuote && depth === 0) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

// Pull the bare email out of "Name <user@host>" or "user@host".
function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return addr.trim().replace(/[\r\n]/g, "");
}

// Sanitize an arbitrary filename for safe embedding in a quoted MIME
// header parameter. Strips CR/LF (header injection) and replaces quotes
// and backslashes with underscores.
function sanitizeFilenameForHeader(name: string): string {
  return name.replace(/[\r\n"\\]/g, "_");
}

// Fold a base64 string to 76-char lines per RFC-2045. Uses a simple
// slice loop so trailing characters are never dropped.
function foldBase64(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join("\r\n");
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private auth: OAuth2Client;
  private ownedIdentitiesCache: Promise<Set<string>> | null = null;

  constructor(auth: OAuth2Client) {
    this.auth = auth;
    this.gmail = google.gmail({ version: "v1", auth });
  }

  // Addresses the authenticated user is allowed to send mail as (primary
  // mailbox + every sendAs alias). Used by the self-send guardrail and the
  // replyAll Cc dedupe. Cached per client instance because sendAs.list is a
  // round-trip and identities don't change mid-process.
  private getOwnedIdentities(): Promise<Set<string>> {
    if (this.ownedIdentitiesCache) return this.ownedIdentitiesCache;
    this.ownedIdentitiesCache = (async () => {
      const out = new Set<string>();
      try {
        const sendAs = await this.gmail.users.settings.sendAs.list({ userId: "me" });
        for (const s of sendAs.data.sendAs ?? []) {
          if (s.sendAsEmail) out.add(s.sendAsEmail.toLowerCase());
        }
      } catch { /* sendAs scope may not be granted; non-fatal */ }
      return out;
    })();
    return this.ownedIdentitiesCache;
  }

  /**
   * Resolve an Attachment spec into a concrete { filename, mimeType, contentBase64 }
   * tuple ready to embed in a MIME part.
   *
   * Three source modes:
   *   - driveFileId: fetches the file from Google Drive (handles binary files
   *     via alt=media; handles Google-native Docs/Sheets/Slides by exporting
   *     them to PDF, since binary media download isn't supported for those).
   *   - filePath: reads a local file off disk.
   *   - contentBase64: caller already has the bytes.
   */
  private async resolveAttachment(a: Attachment): Promise<{ filename: string; mimeType: string; contentBase64: string }> {
    if ("contentBase64" in a) {
      return { filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 };
    }
    if ("filePath" in a) {
      const buf = readFileSync(a.filePath);
      return {
        filename: a.filename ?? basename(a.filePath),
        mimeType: a.mimeType ?? "application/octet-stream",
        contentBase64: buf.toString("base64"),
      };
    }
    // Drive file ID.
    const drive = google.drive({ version: "v3", auth: this.auth });
    const meta = await drive.files.get({ fileId: a.driveFileId, fields: "name,mimeType" });
    const name = meta.data.name ?? a.driveFileId;
    const mimeType = meta.data.mimeType ?? "application/octet-stream";

    // Google-native docs need export, not alt=media.
    if (mimeType.startsWith("application/vnd.google-apps.")) {
      const exportMime =
        mimeType === "application/vnd.google-apps.document" ? "application/pdf" :
        mimeType === "application/vnd.google-apps.spreadsheet" ? "application/pdf" :
        mimeType === "application/vnd.google-apps.presentation" ? "application/pdf" :
        "application/pdf";
      const res = await drive.files.export(
        { fileId: a.driveFileId, mimeType: exportMime },
        { responseType: "arraybuffer" }
      );
      const buf = Buffer.from(res.data as ArrayBuffer);
      return {
        filename: a.filename ?? `${name}.pdf`,
        mimeType: exportMime,
        contentBase64: buf.toString("base64"),
      };
    }

    const res = await drive.files.get(
      { fileId: a.driveFileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buf = Buffer.from(res.data as ArrayBuffer);
    return {
      filename: a.filename ?? name,
      mimeType,
      contentBase64: buf.toString("base64"),
    };
  }

  /**
   * Build a raw RFC-2822 message ready for base64url encoding.
   * If attachments are present, emits multipart/mixed with the body as the
   * first part and each attachment as a base64-encoded subsequent part.
   */
  /**
   * RFC 2047 encode a header value if it contains non-ASCII characters.
   * Leaves pure-ASCII values untouched.
   */
  private static encodeHeaderValue(value: string): string {
    if (!/[^\x20-\x7E]/.test(value)) return value;
    return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
  }

  /**
   * RFC 2047 encode display names in an address header (To, Cc, Bcc)
   * while leaving the angle-bracket email addresses untouched.
   * e.g. "José García <jose@example.com>" → "=?UTF-8?B?...?= <jose@example.com>"
   */
  private static encodeAddressHeader(header: string): string {
    return header.replace(/([^,<]+?)\s*(<[^>]+>)/g, (_match, name, addr) => {
      const trimmed = name.trim();
      if (!trimmed) return addr;
      return `${GmailClient.encodeHeaderValue(trimmed)} ${addr}`;
    });
  }

  /**
   * Final guardrail: scan all assembled headers for raw non-ASCII bytes.
   * Throws if any slip through, preventing garbled subject lines or
   * display names from reaching the recipient.
   */
  private static validateHeaders(headers: string[]): void {
    for (const line of headers) {
      if (line === "") break; // empty line = end of headers, body follows
      if (/[^\x09\x0A\x0D\x20-\x7E]/.test(line)) {
        throw new Error(
          `MIME header contains raw non-ASCII characters (RFC 2047 violation). ` +
          `Header: "${line.slice(0, 80)}...". This would render as garbled text ` +
          `in most email clients. The buildRawMessage encoder should have caught this.`
        );
      }
    }
  }

  private async buildRawMessage(
    to: string,
    subject: string,
    body: string,
    options?: { cc?: string; bcc?: string; inReplyTo?: string; attachments?: Attachment[] }
  ): Promise<string> {
    const headers: string[] = [
      `To: ${GmailClient.encodeAddressHeader(to)}`,
      `Subject: ${GmailClient.encodeHeaderValue(subject)}`,
      "MIME-Version: 1.0",
    ];
    if (options?.cc) headers.push(`Cc: ${GmailClient.encodeAddressHeader(options.cc)}`);
    if (options?.bcc) headers.push(`Bcc: ${GmailClient.encodeAddressHeader(options.bcc)}`);
    if (options?.inReplyTo) {
      headers.push(`In-Reply-To: ${options.inReplyTo}`);
      headers.push(`References: ${options.inReplyTo}`);
    }

    const hasAttachments = (options?.attachments?.length ?? 0) > 0;

    // Body is always base64-encoded so UTF-8 (emoji, curly quotes, accented
    // names) and long lines pass through downstream MTAs cleanly. 7bit is
    // invalid for non-ASCII and lines > 998 chars; base64 sidesteps both.
    const bodyBase64 = foldBase64(Buffer.from(body, "utf-8").toString("base64"));

    if (!hasAttachments) {
      headers.push("Content-Type: text/plain; charset=utf-8");
      headers.push("Content-Transfer-Encoding: base64");
      GmailClient.validateHeaders(headers);
      headers.push("");
      headers.push(bodyBase64);
      return headers.join("\r\n");
    }

    const boundary = `=_boundary_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    GmailClient.validateHeaders(headers);
    headers.push("");
    headers.push("This is a multipart message in MIME format.");

    const parts: string[] = [];
    parts.push(`--${boundary}`);
    parts.push("Content-Type: text/plain; charset=utf-8");
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(bodyBase64);

    for (const a of options!.attachments!) {
      const resolved = await this.resolveAttachment(a);
      const folded = foldBase64(resolved.contentBase64);
      const safeName = sanitizeFilenameForHeader(resolved.filename);
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${resolved.mimeType}; name="${safeName}"`);
      parts.push("Content-Transfer-Encoding: base64");
      parts.push(`Content-Disposition: attachment; filename="${safeName}"`);
      parts.push("");
      parts.push(folded);
    }
    parts.push(`--${boundary}--`);

    return [headers.join("\r\n"), parts.join("\r\n")].join("\r\n");
  }

  async markAsSpam(messageId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    });
    return `Message ${messageId} marked as spam.`;
  }

  async markAsNotSpam(messageId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
    });
    return `Message ${messageId} moved to inbox.`;
  }

  async applyLabel(messageId: string, labelId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    });
    return `Label ${labelId} applied to message ${messageId}.`;
  }

  async removeLabel(messageId: string, labelId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: [labelId] },
    });
    return `Label ${labelId} removed from message ${messageId}.`;
  }

  async listLabels(): Promise<gmail_v1.Schema$Label[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return res.data.labels || [];
  }

  async searchMessages(query: string, maxResults: number = 10): Promise<gmail_v1.Schema$Message[]> {
    const res = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    if (!res.data.messages) return [];

    const messages = await Promise.all(
      res.data.messages.map((m) =>
        this.gmail.users.messages.get({ userId: "me", id: m.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] })
      )
    );
    return messages.map((m) => m.data);
  }

  async trash(messageId: string): Promise<string> {
    await this.gmail.users.messages.trash({ userId: "me", id: messageId });
    return `Message ${messageId} trashed.`;
  }

  async untrash(messageId: string): Promise<string> {
    await this.gmail.users.messages.untrash({ userId: "me", id: messageId });
    return `Message ${messageId} untrashed.`;
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    options?: { cc?: string; bcc?: string; threadId?: string; inReplyTo?: string; attachments?: Attachment[] }
  ): Promise<{ id: string; threadId: string }> {
    const rawStr = await this.buildRawMessage(to, subject, body, options);
    const raw = Buffer.from(rawStr).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: options?.threadId },
    });
    return { id: res.data.id!, threadId: res.data.threadId! };
  }

  /**
   * Create a Gmail draft. Forrest's standing rule is that I never send emails
   * directly — I create drafts and he presses send himself.
   */
  async createDraft(
    to: string,
    subject: string,
    body: string,
    options?: { cc?: string; bcc?: string; threadId?: string; inReplyTo?: string; attachments?: Attachment[] }
  ): Promise<{ draftId: string; messageId: string; threadId: string }> {
    const rawStr = await this.buildRawMessage(to, subject, body, options);
    const raw = Buffer.from(rawStr).toString("base64url");

    const res = await this.gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId: options?.threadId } },
    });
    return {
      draftId: res.data.id!,
      messageId: res.data.message?.id ?? "",
      threadId: res.data.message?.threadId ?? "",
    };
  }

  async deleteDraft(draftId: string): Promise<string> {
    await this.gmail.users.drafts.delete({ userId: "me", id: draftId });
    return `Draft ${draftId} deleted.`;
  }

  /** Promote an existing draft from Drafts to Sent. */
  async sendDraft(draftId: string): Promise<{ id: string; threadId: string }> {
    const res = await this.gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });
    return { id: res.data.id!, threadId: res.data.threadId! };
  }

  /**
   * Forward an existing message to new recipients. Pulls the original
   * subject, from, date, and body, and wraps them in a standard
   * `---------- Forwarded message ----------` block below an optional
   * prefix note.
   */
  async forwardMessage(
    messageId: string,
    to: string,
    options?: { cc?: string; bcc?: string; note?: string; attachments?: Attachment[] }
  ): Promise<{ id: string; threadId: string }> {
    const original = await this.readMessage(messageId);
    const fwdSubject = original.subject.startsWith("Fwd: ") ? original.subject : `Fwd: ${original.subject}`;
    const blocks: string[] = [];
    if (options?.note) blocks.push(options.note, "");
    blocks.push("---------- Forwarded message ----------");
    blocks.push(`From: ${original.from}`);
    blocks.push(`Date: ${original.date}`);
    blocks.push(`Subject: ${original.subject}`);
    blocks.push(`To: ${original.to}`);
    blocks.push("");
    blocks.push(original.body);

    return this.sendEmail(to, fwdSubject, blocks.join("\n"), {
      cc: options?.cc,
      bcc: options?.bcc,
      attachments: options?.attachments,
    });
  }

  /**
   * Reply-all by default: the new message goes to the original sender,
   * and everyone else on the original To/Cc lines gets carried over to Cc
   * (minus the authenticated user, to avoid self-addressing). Caller-supplied
   * cc is appended on top of that, deduped by email address. Pass
   * `replyAll: false` to drop the carry-over and behave as reply-to-sender.
   */
  async replyToMessage(
    messageId: string,
    body: string,
    options?: { cc?: string; bcc?: string; attachments?: Attachment[]; replyAll?: boolean }
  ): Promise<{ id: string; threadId: string }> {
    const original = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["From", "Reply-To", "To", "Cc", "Delivered-To", "Subject", "Message-ID"],
    });
    const headers = original.data.payload?.headers || [];
    const headerValue = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const from = headerValue("From");
    const replyToHeader = headerValue("Reply-To");
    const toHeader = headerValue("To");
    const ccHeader = headerValue("Cc");
    const deliveredTo = headerValue("Delivered-To");
    const subject = headerValue("Subject");
    const msgId = headerValue("Message-ID") || undefined;
    const reSubject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;

    // Prefer Reply-To over From if present (mailing lists, automated senders).
    const newTo = replyToHeader || from;

    const ownedIdentities = await this.getOwnedIdentities();

    // Guard: if the message being replied to was sent BY the authenticated
    // user (From: matches one of our own identities), a default
    // replyAll=false reply would resolve `to` back to the user's own
    // mailbox instead of the real recipient on the thread. That's almost
    // never what the caller intends — they want to drop a follow-up into
    // the existing thread that reaches the original recipient. Fail loud
    // with an actionable message so the caller flips to replyAll=true (to
    // carry the original To/Cc forward) or switches to gmail_send with an
    // explicit `to` + `threadId`.
    const replyAll = options?.replyAll !== false;
    const fromEmail = extractEmail(from).toLowerCase();
    if (!replyAll && fromEmail && ownedIdentities.has(fromEmail)) {
      throw new Error(
        `gmail_reply refused: the original message (id ${messageId}) was sent by the authenticated account itself (${fromEmail}), so replyAll=false would send the reply back to you instead of to the real recipient on the thread. Pass replyAll=true to carry the original To/Cc recipients forward, or switch to gmail_send with an explicit \`to\` and \`threadId: "${original.data.threadId}"\` to drop a fresh message into this thread.`,
      );
    }

    // Carry-over recipients from the original thread (To + Cc), excluding
    // every identity that belongs to the authenticated user (primary,
    // Delivered-To alias, and any sendAs identities) so we don't self-address.
    // Merged with caller-supplied cc and deduped by bare email address.
    let mergedCc = options?.cc;
    if (replyAll) {
      const seen = new Set<string>(ownedIdentities);
      if (deliveredTo) {
        const d = extractEmail(deliveredTo).toLowerCase();
        if (d) seen.add(d);
      }
      // Also exclude the recipient of the new reply — they're on the To line.
      const newToEmail = extractEmail(newTo).toLowerCase();
      if (newToEmail) seen.add(newToEmail);

      const carryOver = [...splitAddressList(toHeader), ...splitAddressList(ccHeader)];
      const manual = splitAddressList(options?.cc ?? "");
      const keep: string[] = [];
      for (const addr of [...carryOver, ...manual]) {
        const email = extractEmail(addr).toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        keep.push(addr);
      }
      mergedCc = keep.length > 0 ? keep.join(", ") : undefined;
    }

    return this.sendEmail(newTo, reSubject, body, {
      cc: mergedCc,
      bcc: options?.bcc,
      threadId: original.data.threadId!,
      inReplyTo: msgId,
      attachments: options?.attachments,
    });
  }

  async readMessage(messageId: string): Promise<{ from: string; to: string; subject: string; date: string; body: string; threadId: string }> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const msg = res.data;
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    // Walk the MIME tree to find text/plain (preferred) or text/html (fallback)
    const extractBody = (part: gmail_v1.Schema$MessagePart | undefined): { plain: string; html: string } => {
      if (!part) return { plain: "", html: "" };
      let plain = "";
      let html = "";
      const mime = part.mimeType || "";
      if (mime === "text/plain" && part.body?.data) {
        plain = Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (mime === "text/html" && part.body?.data) {
        html = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        for (const sub of part.parts) {
          const r = extractBody(sub);
          if (!plain && r.plain) plain = r.plain;
          if (!html && r.html) html = r.html;
        }
      }
      return { plain, html };
    };

    const { plain, html } = extractBody(msg.payload || undefined);
    let body = plain;
    if (!body && html) {
      // Strip HTML tags as a fallback
      body = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    }
    if (!body && msg.snippet) body = msg.snippet;

    return {
      from: getHeader("From"),
      to: getHeader("To"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
      body,
      threadId: msg.threadId || "",
    };
  }

  async listAttachments(messageId: string): Promise<{ filename: string; mimeType: string; attachmentId: string; size: number }[]> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const parts: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
    const walk = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        parts.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
      if (part.parts) for (const sub of part.parts) walk(sub);
    };
    if (res.data.payload) walk(res.data.payload);
    return parts;
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<{ data: Buffer }> {
    const res = await this.gmail.users.messages.attachments.get({
      userId: "me",
      id: attachmentId,
      messageId,
    });
    const data = Buffer.from(res.data.data!, "base64url");
    return { data };
  }

  async batchMarkAsSpam(messageIds: string[]): Promise<string> {
    await this.gmail.users.messages.batchModify({
      userId: "me",
      requestBody: { ids: messageIds, addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    });
    return `${messageIds.length} messages marked as spam.`;
  }
}
