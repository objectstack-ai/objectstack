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
  titleFormat: '{subject}',
  compactLayout: ['subject', 'to', 'status', 'sent_at'],

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
});
