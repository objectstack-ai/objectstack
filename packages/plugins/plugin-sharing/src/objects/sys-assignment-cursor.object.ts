// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_assignment_cursor — the round-robin position of one assignment-rule
 * entry in one organization (ADR-0142 D5).
 *
 * One row per (rule, entry, organization), holding the member the entry last
 * chose and a version. The engine advances it under its by-id write
 * precondition (`expect: { version }` as read), so two concurrent inserts
 * cannot both read the same position and pick the same member; the loser
 * re-reads and retries. A member set that changed since the last assignment
 * is handled by position: the next member after `last_user_id` in the current
 * ordering.
 *
 * Engine-owned: no user writes it, and nothing reads it but the assignment
 * step.
 *
 * @namespace sys
 */
export const SysAssignmentCursor = ObjectSchema.create({
  name: 'sys_assignment_cursor',
  label: 'Assignment Cursor',
  pluralLabel: 'Assignment Cursors',
  icon: 'rotate-cw',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Where round-robin assignment last left off, per assignment rule entry.',
  displayNameField: 'rule',
  nameField: 'rule',
  highlightFields: ['rule', 'entry', 'last_user_id', 'version'],

  fields: {
    rule: Field.text({
      label: 'Assignment Rule',
      required: true,
      maxLength: 100,
      description: 'The name of the assignment rule.',
      group: 'Rule',
    }),

    // [ADR-0150 D8 row R13] The package that holds the assignment rule `rule`
    // names, beside the name (ADR-0126 §4: two facts, two columns). Backfilled
    // at boot from the rule's one package holder
    // (`stored-declaration-package-backfill.ts`); empty for a name no single
    // package holds. The engine still reads and writes the cursor by name
    // alone, so a cursor written after a boot is filled by the next one.
    // Width: the package-id class (`sys_metadata.package_id`).
    rule_package: Field.text({
      label: 'Assignment Rule Package',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'The app the assignment rule comes from.',
      group: 'Rule',
    }),

    entry: Field.text({
      label: 'Entry',
      required: true,
      maxLength: 100,
      description: 'The name of the rule entry whose rotation this is.',
      group: 'Rule',
    }),

    last_user_id: Field.text({
      label: 'Last Assigned User',
      required: false,
      maxLength: 200,
      description: 'The member this entry assigned a record to most recently.',
      group: 'State',
    }),

    version: Field.number({
      label: 'Version',
      required: true,
      defaultValue: 0,
      description: 'Advanced by one on every assignment; a concurrent advance that read an older value retries.',
      group: 'State',
    }),
  },

  indexes: [
    { fields: ['rule', 'entry'], unique: 'organization' },
  ],
});
