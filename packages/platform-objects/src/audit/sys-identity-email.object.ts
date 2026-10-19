// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_identity_email — Outbound Identity Mail Log
 *
 * The deployment-level sibling of `sys_email` (ADR-0131 D7, ruling of record
 * 6257510973, letter Q2 A). Identity mail is mail about a PERSON rather than
 * an organization — verification, password reset, magic link, email-change
 * notice, an account invitation to someone who belongs to no organization
 * yet — so it has no organization to stamp. It lives here, with no
 * organization column, instead of as an organization-less row in the tenant
 * mail log: ⛔ neither a nullable column nor unpersisted mail.
 *
 * Same row shape as `sys_email` — its fields, held equal by a test — and the
 * same pipeline: `IEmailService.send` with
 * `identityMail: true` writes the row, and the queue worker, the outbox drain
 * hook, the boot outbox sweep and attachment reclamation read it by id and
 * status exactly as they read `sys_email`.
 *
 * Expand-first: rows an 18.0 install wrote to `sys_email` for this mail stay
 * there; the mail pipeline keeps reading them, and moving them is the 18.x
 * upgrade ceremony's.
 *
 * `systemFields: { tenant: false }` removes the injected organization column.
 * With no column there is no tenant wall, so who may read is object
 * permission (D7): these rows carry password-reset and sign-in links, so the
 * platform-only capability, as on `sys_job` — under a wall an organization's
 * administrator must not read every person's links.
 *
 * Typical writers: `IEmailService.send()` / `sendTemplate()` with `identityMail: true`
 * (plugin-auth's identity mails).
 * Typical readers: the mail delivery pipeline, the platform administrator.
 *
 * @namespace sys
 */
export const SysIdentityEmail = ObjectSchema.create({
  name: 'sys_identity_email',
  label: 'Identity Email',
  pluralLabel: 'Identity Emails',
  icon: 'mail',
  isSystem: true,
  managedBy: 'append-only',
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description: 'Outbound identity mail log — verification, password reset and sign-in mail about a person, not an organization',
  displayNameField: 'subject',
  nameField: 'subject', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{subject}',
  highlightFields: ['subject', 'to_addresses', 'status', 'sent_at'],

  // `sys_email`'s fields, written out: the source scans that judge an
  // object's columns (`check:keyed-text-bounds`) read a literal, never a
  // reference. `sys-identity-email.object.test.ts` holds the two equal, so
  // the row shape cannot drift; the reasoning behind each field lives on
  // `sys_email`.
  fields: {
    id: Field.text({
      label: 'Email ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

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
      requiredPermissions: ['manage_platform_settings'],
      group: 'Content',
    }),

    body_html: Field.textarea({
      label: 'Body (HTML)',
      required: false,
      requiredPermissions: ['manage_platform_settings'],
      group: 'Content',
    }),

    headers_json: Field.textarea({
      label: 'Headers (JSON)',
      required: false,
      internal: true,
      description:
        'Custom headers supplied with the message when it was sent, as a JSON object of name → value. '
        + 'Written in both delivery modes (it is audit evidence as much as delivery input). '
        + 'Absent on rows written before this column existed, which read back as "no custom headers". '
        + 'Never returned on the generic data path — headers are the ordinary place a '
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

    status: Field.select(
      ['queued', 'sent', 'failed'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'queued',
        description: 'Lifecycle state — queued when the message is submitted for sending, before the first delivery attempt',
        group: 'State',
      },
    ),

    error: Field.textarea({
      label: 'Error',
      required: false,
      description:
        'Why the message failed — a transport error, or the validation that rejected it before delivery.',
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
    // [ADR-0103] Engine-owned append-only mail log, as `sys_email`: written
    // only by the mail service (SYSTEM_CTX). Reads behind the permission above.
    apiMethods: ['get', 'list'],
  },
});
