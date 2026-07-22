// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_attachment — Polymorphic File ↔ Record Link
 *
 * Generic join row that attaches a previously-uploaded `sys_file` to
 * any other record. Mirrors the Salesforce "ContentDocumentLink" /
 * ServiceNow "sys_attachment" pattern: file storage and "where this
 * file is attached" are separated, so the same `sys_file` row can be
 * surfaced on multiple records, an org-wide library, or a thread.
 *
 * Conventions:
 *  - `parent_object` is the short object name (e.g. `account`, `lead`,
 *    `opportunity`, `case`, `sys_comment`).
 *  - `parent_id` is the parent record's primary key.
 *  - `(parent_object, parent_id)` is the natural index for the
 *    "files on this record" lookup.
 *  - Access is derived from the PARENT record (Salesforce semantics),
 *    enforced by service-storage's attachment access hooks (#2755).
 *    Salesforce's `ShareType`/`Visibility` dials were modeled here in v1
 *    but had no runtime consumer — removed per ADR-0049 enforce-or-remove;
 *    reintroduce them together with their enforcement if ever needed.
 *
 * @namespace sys
 */
export const SysAttachment = ObjectSchema.create({
  name: 'sys_attachment',
  label: 'Attachment',
  pluralLabel: 'Attachments',
  icon: 'paperclip',
  isSystem: true,
  managedBy: 'platform',
  description: 'Polymorphic link between a sys_file and any other record',
  titleFormat: '{file_name} → {parent_object}/{parent_id}',
  highlightFields: ['created_at', 'parent_object', 'file_name', 'mime_type', 'size'],

  fields: {
    id: Field.text({
      label: 'Attachment ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Parent (polymorphic) ────────────────────────────────────
    parent_object: Field.text({
      label: 'Parent Object',
      required: true,
      searchable: true,
      maxLength: 128,
      description: 'Short object name of the attached-to record (e.g. account, lead)',
      group: 'Parent',
    }),

    parent_id: Field.text({
      label: 'Parent Record',
      required: true,
      searchable: true,
      maxLength: 64,
      description: 'Primary key of the attached-to record',
      group: 'Parent',
    }),

    // ── File reference ──────────────────────────────────────────
    file_id: Field.lookup('sys_file', {
      label: 'File',
      required: true,
      description: 'The sys_file storage entry being attached',
      group: 'File',
    }),

    file_name: Field.text({
      label: 'File Name',
      required: false,
      searchable: true,
      maxLength: 255,
      description: 'Denormalised copy of sys_file.name for fast list rendering',
      group: 'File',
    }),

    mime_type: Field.text({
      label: 'MIME Type',
      required: false,
      maxLength: 128,
      group: 'File',
    }),

    size: Field.number({
      label: 'Size (bytes)',
      required: false,
      group: 'File',
    }),

    // ── Authoring ──────────────────────────────────────────────
    uploaded_by: Field.lookup('sys_user', {
      label: 'Uploaded By',
      required: false,
      group: 'System',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      maxLength: 1024,
      group: 'File',
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
    { fields: ['parent_object', 'parent_id', 'created_at'] },
    { fields: ['file_id'] },
    { fields: ['uploaded_by'] },
  ],

  enable: {
    trackHistory: false,
    searchable: true,
    apiEnabled: true,
    // [#2970 item 5 / ADR-0049] `trash` is `dead` in the liveness ledger (no
    // engine soft-delete reader) and attachment deletes ARE hard (#2755): the
    // reap guard reclaims a file's bytes once its last join row is gone, so a
    // "restore" would dangle. Declare `false` — the honest state — rather than
    // claim a restore capability the runtime does not provide.
    clone: false,
  },
});
