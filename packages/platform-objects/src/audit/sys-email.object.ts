// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_email — Outbound Email Log
 *
 * Persistent record of every email the platform has tried to deliver.
 * Lets administrators audit campaigns, debug delivery failures, and
 * lets users see "what was sent" from a record's activity stream.
 *
 * The actual SMTP / API delivery is performed by an `IEmailTransport`
 * implementation injected into the EmailServicePlugin (e.g. nodemailer,
 * SendGrid, Resend). This object only stores the outcome.
 *
 * Typical writers: `IEmailService.send()`.
 * Typical readers: activity timeline, deliverability dashboard.
 *
 * @namespace sys
 */
export const SysEmail = ObjectSchema.create({
  name: 'sys_email',
  label: 'Email',
  pluralLabel: 'Emails',
  icon: 'mail',
  isSystem: true,
  managedBy: 'append-only',
  description: 'Outbound email delivery log',
  displayNameField: 'subject',
  nameField: 'subject', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{subject}',
  highlightFields: ['subject', 'to', 'status', 'sent_at'],

  fields: {
    id: Field.text({
      label: 'Email ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Envelope ─────────────────────────────────────────────────
    message_id: Field.text({
      label: 'Message-ID',
      required: false,
      maxLength: 255,
      description: 'RFC-5322 Message-ID assigned by the transport',
      group: 'Envelope',
    }),

    from_address: Field.text({
      label: 'From',
      required: true,
      maxLength: 320,
      searchable: true,
      group: 'Envelope',
    }),

    to_addresses: Field.text({
      label: 'To',
      required: true,
      maxLength: 4000,
      searchable: true,
      description: 'Comma-separated recipient addresses',
      group: 'Envelope',
    }),

    cc_addresses: Field.text({
      label: 'Cc',
      required: false,
      maxLength: 4000,
      group: 'Envelope',
    }),

    bcc_addresses: Field.text({
      label: 'Bcc',
      required: false,
      maxLength: 4000,
      group: 'Envelope',
    }),

    reply_to: Field.text({
      label: 'Reply-To',
      required: false,
      maxLength: 320,
      group: 'Envelope',
    }),

    // ── Content ──────────────────────────────────────────────────
    subject: Field.text({
      label: 'Subject',
      required: true,
      maxLength: 998,
      searchable: true,
      group: 'Content',
    }),

    body_text: Field.textarea({
      label: 'Body (text)',
      required: false,
      searchable: true,
      group: 'Content',
    }),

    body_html: Field.textarea({
      label: 'Body (HTML)',
      required: false,
      group: 'Content',
    }),

    // ── Message parts a row must carry to be deliverable (#5177) ─
    // Delivery of a queued / stranded / app-inserted message happens FROM
    // THIS ROW, not from the in-memory message: `send()` publishes an
    // `{ rowId }` job (#5160) and the boot sweep re-reads rows (#5161). Any
    // part of the message the row cannot carry is therefore a part a durable
    // delivery silently drops — which is why messages with headers or
    // attachments used to be pushed back onto inline delivery instead.
    // [#8149] `internal: true` — custom headers are the ordinary place a
    // credential goes (an SMTP relay's `Authorization`, a provider token, a
    // routing secret), the same shape #8118 ruled on for
    // `sys_http_delivery.headers_json`, and this table is readable over the
    // ordinary data API (`enable.apiMethods` below). So the engine OMITS the
    // column from every generic read: list, get, an explicit
    // `?select=headers_json`, and the write-response bodies — with no system
    // carve-out (#7728's explicit design; `SYSTEM_CTX` does not reopen it).
    //
    // The redaction sits at the ROW layer, so it covers every producer of the
    // column by construction, not just the one that exists today
    // (`IEmailService.send` → `encodeHeadersForRow`). Unlike
    // `sys_http_delivery`, `sys_email` has no second authoring population to
    // cover — `apiMethods` admits no `create`, so the only writer is the mail
    // service's own persistence seam — but the placement means an in-process
    // writer added later inherits the protection instead of having to
    // re-declare it.
    //
    // Delivery is unaffected: the durable delivery paths (queue worker, boot
    // outbox sweep, the after-insert drain hook) all re-read the row and hand
    // it to `EmailService.deliverPersistedRow`, which recovers this column
    // through ObjectQL's privileged accessor (`resolveInternalField`, the
    // remedy #7728 named and #8118 landed) — see
    // `plugin-email/src/internal-header-readback.ts`. Fail-closed: a message
    // whose authored headers cannot be recovered is NOT sent without them (a
    // header that silently goes missing is not self-announcing — the receiver
    // that does not require it accepts the mail while the delivery deviates
    // from the authored configuration).
    //
    // Read-side only, deliberately, exactly as #8118 ruled for the sibling
    // column: storage is untouched and the row still carries the map in
    // cleartext. `Field.secret()` was measured and REJECTED there (an orphan
    // `sys_secret` row per delivery with no cascade or retention, a
    // boot-window fail-open, a per-row decrypt on every tick); this card
    // adopts that decision rather than re-deciding it.
    headers_json: Field.textarea({
      label: 'Headers (JSON)',
      required: false,
      internal: true,
      description:
        'Custom headers supplied to IEmailService.send, as a JSON object of name → value. '
        + 'Written in both delivery modes (it is audit evidence as much as delivery input). '
        + 'Absent on rows written before this column existed, which read back as "no custom headers". '
        + 'Never returned on the generic data path (#8149) — headers are the ordinary place a '
        + 'credential goes; the delivery paths recover it through the engine\'s privileged accessor.',
      group: 'Content',
    }),

    attachments_json: Field.textarea({
      label: 'Attachments (JSON)',
      required: false,
      description:
        'Attachments as a JSON array of { filename, contentType?, size, hash, cid?, contentForm, '
        + 'inline?, storageKey?, contentReclaimedAt? }. Content up to the plugin-email budget '
        + '(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES, 256 KiB combined raw — ~350 KB of base64 at worst) is base64 in '
        + '`inline`; larger content goes to the file-storage capability and the element carries `storageKey` '
        + 'instead, so the row stays bounded either way. filename/contentType/size/hash are PERMANENT audit '
        + 'evidence; out-of-row content is a delivery artifact and is deleted a grace window after the row '
        + 'reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`.',
      group: 'Content',
    }),

    // ── Delivery state ───────────────────────────────────────────
    status: Field.select(
      ['queued', 'sent', 'failed'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'queued',
        description: 'Lifecycle state — queued by IEmailService.send before transport call',
        group: 'State',
      },
    ),

    error: Field.textarea({
      label: 'Error',
      required: false,
      description: 'Transport error message when status=failed',
      group: 'State',
    }),

    attempt_count: Field.number({
      label: 'Attempts',
      required: false,
      defaultValue: 0,
      description: 'Number of delivery attempts performed by the service',
      group: 'State',
    }),

    sent_at: Field.datetime({
      label: 'Sent At',
      required: false,
      description: 'Set when status transitions to "sent"',
      group: 'State',
    }),

    // ── Source linkage ───────────────────────────────────────────
    related_object: Field.text({
      label: 'Related Object',
      required: false,
      maxLength: 100,
      description: 'Object name of the related record (e.g. lead, opportunity)',
      group: 'Source',
    }),

    related_id: Field.text({
      label: 'Related Record',
      required: false,
      maxLength: 100,
      description: 'Record id within related_object',
      group: 'Source',
    }),

    sent_by: Field.lookup('sys_user', {
      label: 'Sent By',
      required: false,
      group: 'Source',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['status', 'created_at'] },
    { fields: ['related_object', 'related_id'] },
    { fields: ['sent_by'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned append-only mail log: written only by the mail
    // service (SYSTEM_CTX; even the status update is system-elevated). Reads open.
    apiMethods: ['get', 'list'],
  },
});
