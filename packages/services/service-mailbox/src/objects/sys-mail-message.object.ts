// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_mail_message — Inbound Mail Message
 *
 * A faithful mirror of one inbound message as it arrived in a mailbox
 * (`sys_mailbox`). Its schema is dictated by the external standard, RFC 5322:
 * participants, message id and threading references, subject, body parts, and
 * attachments by file reference (`sys_attachment` rows with this object as
 * their parent). It is the inbound counterpart of the outbound log `sys_email`.
 *
 * Mirror, not adopt: apps keep their own business objects and reach a message
 * through a declared association (`sys_mail_association`), stamped at ingest
 * from the email fields an app flags with `mailAssociation`. ⛔ Apps never
 * extend this object with business keys.
 *
 * A message no record matched stays in the UNASSOCIATED POOL
 * (`association_state: 'unassociated'`), never dropped, and is associated later
 * when a matching record appears. The pool is RESTRICTED: the read gate serves
 * a message to a caller who can read a record it is associated with, to its
 * mailbox's owner, and to holders of `manage_mailboxes` — so a pool message,
 * which has no associated record, only to the latter two.
 *
 * The ingest service is the only writer; the data API serves `get` and `list`.
 *
 * @namespace sys
 */
export const SysMailMessage = ObjectSchema.create({
  name: 'sys_mail_message',
  label: 'Mail Message',
  pluralLabel: 'Mail Messages',
  icon: 'mail-open',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Inbound mail message mirrored from a mailbox',
  displayNameField: 'subject',
  nameField: 'subject', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{subject}',
  highlightFields: ['subject', 'from_address', 'received_at', 'association_state'],

  fields: {
    id: Field.text({
      label: 'Message ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    mailbox_id: Field.lookup('sys_mailbox', {
      label: 'Mailbox',
      required: true,
      readonly: true,
      description: 'The mailbox the message arrived in',
      group: 'Envelope',
    }),

    // ── Identity and threading (RFC 5322 §3.6.4) ────────────────
    message_id: Field.text({
      label: 'Message-ID',
      required: false,
      readonly: true,
      maxLength: 998,
      description: 'The Message-ID header, angle brackets stripped',
      group: 'Threading',
    }),

    in_reply_to: Field.textarea({
      label: 'In-Reply-To',
      required: false,
      readonly: true,
      description: 'The In-Reply-To header: the message ids this message replies to, space-separated',
      group: 'Threading',
    }),

    reference_ids: Field.textarea({
      label: 'References',
      required: false,
      readonly: true,
      description: 'The References header: the message ids of the thread, space-separated',
      group: 'Threading',
    }),

    // ── Participants (RFC 5322 §3.6.2, §3.6.3) ──────────────────
    from_address: Field.text({
      label: 'From',
      required: false,
      readonly: true,
      maxLength: 320,
      searchable: true,
      description: 'The first From address. A message without one is still mirrored, never dropped.',
      group: 'Envelope',
    }),

    from_name: Field.text({
      label: 'From Name',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'The display name of the first From address',
      group: 'Envelope',
    }),

    sender_address: Field.text({
      label: 'Sender',
      required: false,
      readonly: true,
      maxLength: 320,
      description: 'The Sender header, when the message carries one',
      group: 'Envelope',
    }),

    reply_to: Field.text({
      label: 'Reply-To',
      required: false,
      readonly: true,
      maxLength: 4000,
      description: 'Comma-separated Reply-To addresses',
      group: 'Envelope',
    }),

    to_addresses: Field.text({
      label: 'To',
      required: false,
      readonly: true,
      maxLength: 4000,
      searchable: true,
      description: 'Comma-separated To addresses',
      group: 'Envelope',
    }),

    cc_addresses: Field.text({
      label: 'Cc',
      required: false,
      readonly: true,
      maxLength: 4000,
      description: 'Comma-separated Cc addresses',
      group: 'Envelope',
    }),

    sent_at: Field.datetime({
      label: 'Sent At',
      required: false,
      readonly: true,
      description: 'The Date header: when the sender says the message was written',
      group: 'Envelope',
    }),

    received_at: Field.datetime({
      label: 'Received At',
      required: true,
      readonly: true,
      description: 'When the mailbox received the message',
      group: 'Envelope',
    }),

    // ── Content ──────────────────────────────────────────────────
    subject: Field.text({
      label: 'Subject',
      required: false,
      readonly: true,
      maxLength: 998,
      searchable: true,
      group: 'Content',
    }),

    body_text: Field.textarea({
      label: 'Body (text)',
      required: false,
      readonly: true,
      searchable: true,
      group: 'Content',
    }),

    // Plain text, never the `html` type: the sender controls this markup, so it
    // is stored verbatim and shown only through a sanitizing renderer.
    body_html: Field.textarea({
      label: 'Body (HTML)',
      required: false,
      readonly: true,
      description: 'The HTML part as the sender wrote it, stored verbatim and never rendered unsanitized',
      group: 'Content',
    }),

    // ── Association ──────────────────────────────────────────────
    match_addresses: Field.textarea({
      label: 'Match Addresses',
      required: false,
      readonly: true,
      description: 'The participant addresses the association seam was asked about, minus the mailbox’s own address; a re-match replays exactly these',
      group: 'Association',
    }),

    association_state: Field.select({
      label: 'Association',
      required: true,
      readonly: true,
      defaultValue: 'unassociated',
      options: [
        { value: 'associated', label: 'Associated' },
        { value: 'unassociated', label: 'Unassociated' },
      ],
      description: 'Whether any record matched the message. An unassociated message waits in the restricted pool.',
      group: 'Association',
    }),

    dedupe_key: Field.text({
      label: 'Dedupe Key',
      required: true,
      readonly: true,
      maxLength: 128,
      description: 'Hash of the normalized Message-ID (or of the header block when there is none); one row per message per mailbox',
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['mailbox_id', 'dedupe_key'], unique: 'organization' },
    { fields: ['association_state', 'received_at'], unique: false },
    { fields: ['mailbox_id', 'received_at'], unique: false },
  ],

  enable: {
    apiMethods: ['get', 'list'],
    files: true,
  },
});
