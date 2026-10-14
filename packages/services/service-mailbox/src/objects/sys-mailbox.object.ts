// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_mailbox — Inbound Mailbox
 *
 * One mailbox the platform mirrors inbound mail from: a shared address that
 * people forward or BCC to. This object carries the mailbox's IDENTITY only —
 * which address it is and who owns it — because that is what the mail read
 * gates need: the owner is served the mailbox's unassociated messages, and the
 * address is the one participant the association seam never matches.
 *
 * It also carries the IMAP SYNC CURSOR — which folder was read, under which
 * UIDVALIDITY, up to which UID — written only by the mailbox sync
 * (`sync/mailbox-sync-service.ts`). The account and credential the sync
 * connects with are NOT stored here: the host composition supplies them per
 * mailbox (`MailboxServicePlugin({ imap: { accountFor } })`), the way every
 * open connector takes its credential, so this object holds no secret.
 *
 * Readers: the `sys_mail_message` read gate (the owner limb, read under system
 * context) and the mailbox sync (the cursor). The directory itself is served
 * only to holders of `manage_mailboxes`.
 *
 * @namespace sys
 */
export const SysMailbox = ObjectSchema.create({
  name: 'sys_mailbox',
  label: 'Mailbox',
  pluralLabel: 'Mailboxes',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'engine-owned',
  requiredPermissions: ['manage_mailboxes'],
  description: 'An inbound mailbox the platform mirrors mail from: its address and its owner',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'address', 'owner_user_id'],

  fields: {
    id: Field.text({
      label: 'Mailbox ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 255,
      searchable: true,
      description: 'Display name of the mailbox (for example "Sales inbox")',
    }),

    address: Field.email({
      label: 'Address',
      required: true,
      maxLength: 320,
      searchable: true,
      description: 'The mailbox address. Never matched as a participant: a message to this mailbox is not about the mailbox itself.',
    }),

    owner_user_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: false,
      description: 'The user who owns this mailbox. The owner is served every message that arrived in it, unassociated ones included.',
    }),

    // ── IMAP sync cursor (RFC 3501 §2.3.1.1): written by the mailbox sync only ──
    imap_folder: Field.text({
      label: 'Synced Folder',
      required: false,
      readonly: true,
      maxLength: 1000,
      description: 'The IMAP folder the sync cursor belongs to. When the mailbox is synced from another folder, the cursor starts over.',
      group: 'Sync',
    }),

    imap_uid_validity: Field.number({
      label: 'UIDVALIDITY',
      required: false,
      readonly: true,
      description: 'The folder UIDVALIDITY the cursor was taken under. When the server reports another value, its UIDs name other messages and the cursor starts over.',
      group: 'Sync',
    }),

    imap_last_uid: Field.number({
      label: 'Last Synced UID',
      required: false,
      readonly: true,
      description: 'The highest UID of the folder already handed to ingest (stored, found already stored, suppressed or skipped). The next sync fetches the UIDs above it.',
      group: 'Sync',
    }),

    imap_synced_at: Field.datetime({
      label: 'Last Synced At',
      required: false,
      readonly: true,
      description: 'When the sync last finished a pass over the folder.',
      group: 'Sync',
    }),
  },

  indexes: [
    { fields: ['owner_user_id'], unique: false },
  ],

  enable: {
    apiMethods: ['get', 'list'],
  },
});
