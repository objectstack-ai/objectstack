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
    headers_json: Field.textarea({
      label: 'Headers (JSON)',
      required: false,
      description:
        'Custom headers supplied to IEmailService.send, as a JSON object of name → value. '
        + 'Written in both delivery modes (it is audit evidence as much as delivery input). '
        + 'Absent on rows written before this column existed, which read back as "no custom headers".',
      group: 'Content',
    }),

    attachments_json: Field.textarea({
      label: 'Attachments (JSON)',
      required: false,
      description:
        'Attachments as a JSON array of { filename, contentType?, size, hash, cid?, contentForm, '
        + 'inline?, storageKey? }, with content base64 in `inline`. Written only when the combined raw '
        + 'size is within the plugin-email budget (SYS_EMAIL_ATTACHMENT_LIMIT_BYTES, 256 KiB — ~350 KB of '
        + 'base64 at worst); a larger message is delivered inline and stores nothing here, so the row '
        + 'stays bounded. `storageKey` (out-of-row content) has no producer yet — objectstack#5172.',
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
