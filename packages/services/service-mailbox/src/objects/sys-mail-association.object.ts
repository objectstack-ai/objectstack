// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_mail_association — Mail Association
 *
 * One link between a mirrored inbound message and a record of the app's own
 * objects: "this message belongs to that record". A message routinely belongs
 * to several records (its To and Cc name several known correspondents), so the
 * link is its own object, as `sys_attachment` links one file to many parents.
 *
 * Stamped at ingest, and added by an explicit re-match; never removed by one
 * (re-match is additive). A row records which participant address matched
 * which flagged email field (`FieldSchema.mailAssociation`), so an association
 * is an auditable fact, not a read-time guess.
 *
 * The parent pair is the ActivityPointer pair (`object_name`, `record_id`,
 * ADR-0052 §5), so the parent-record read gate applies unchanged: a row is
 * served to a caller who can read the record it names, or who holds
 * `manage_mailboxes`.
 *
 * @namespace sys
 */
export const SysMailAssociation = ObjectSchema.create({
  name: 'sys_mail_association',
  label: 'Mail Association',
  pluralLabel: 'Mail Associations',
  icon: 'link',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Links a mirrored inbound message to a record it belongs to',
  displayNameField: 'matched_address',
  nameField: 'matched_address', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{matched_address}',
  highlightFields: ['mail_message_id', 'object_name', 'record_id', 'matched_address'],

  fields: {
    id: Field.text({
      label: 'Association ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    mail_message_id: Field.lookup('sys_mail_message', {
      label: 'Message',
      required: true,
      readonly: true,
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'Machine name of the object the associated record belongs to',
      group: 'Record',
    }),

    // The id half of the ActivityPointer pair; bounded at 255, the width of
    // every table's primary key, so the `(object_name, record_id)` index below
    // is expressible on MySQL (the `sys_activity.record_id` reasoning).
    record_id: Field.text({
      label: 'Record ID',
      required: true,
      readonly: true,
      maxLength: 255,
      referenceVia: 'object_name',
      description: 'Id of the associated record, in the object named by Object',
      group: 'Record',
    }),

    matched_address: Field.text({
      label: 'Matched Address',
      required: true,
      readonly: true,
      maxLength: 320,
      description: 'The participant address that matched the record',
      group: 'Match',
    }),

    matched_field: Field.text({
      label: 'Matched Field',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The email field of the record whose value equalled the matched address',
      group: 'Match',
    }),

    matched_by: Field.select({
      label: 'Matched By',
      required: true,
      readonly: true,
      options: [
        { value: 'ingest', label: 'Ingest' },
        { value: 'rematch', label: 'Re-match' },
      ],
      description: 'Whether the link was stamped when the message arrived or added by a later re-match',
      group: 'Match',
    }),
  },

  indexes: [
    { fields: ['mail_message_id', 'object_name', 'record_id'], unique: 'organization' },
    { fields: ['object_name', 'record_id'], unique: false },
  ],

  enable: {
    apiMethods: ['get', 'list'],
  },
});
