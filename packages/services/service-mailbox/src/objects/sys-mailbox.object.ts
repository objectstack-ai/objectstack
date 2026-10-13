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
 * The connector account, credential and folder cursor that make a mailbox
 * ingest are added by the ingest half of the inbound-mail programme, together
 * with their writer.
 *
 * Readers: the `sys_mail_message` read gate (the owner limb, read under system
 * context). The directory itself is served only to holders of
 * `manage_mailboxes`.
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
  },

  indexes: [
    { fields: ['owner_user_id'], unique: false },
  ],

  enable: {
    apiMethods: ['get', 'list'],
  },
});
