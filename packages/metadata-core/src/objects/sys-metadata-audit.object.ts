// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_audit — Metadata Protection Audit Log
 *
 * Append-only audit trail for every metadata write **decision** — both
 * allowed writes and refused ones. Introduced in ADR-0010 Phase 1 as
 * the compliance surface for the new `_lock` enforcement: every PUT /
 * publish / rollback / delete that targets `sys_metadata` writes one
 * row here describing the outcome and the lock state that produced it.
 *
 * Distinct from `sys_metadata_history`:
 *  - `sys_metadata_history` records the **body** of every successful
 *    write (full JSON snapshot + checksum). Used for rollback,
 *    diff, and history() reads.
 *  - `sys_metadata_audit` records the **decision** (who tried what,
 *    what code was emitted, was a lock involved). Refused writes
 *    never reach history; they DO reach audit.
 *
 * Designed as the smallest possible row that satisfies the four
 * compliance questions of metadata governance:
 *  1. Who tried to change what?         → actor + type + name
 *  2. When?                             → occurred_at
 *  3. What outcome?                     → outcome + code
 *  4. Was an override involved?         → lock_overridden + lock_state
 *
 * Indexed on `(organization_id, occurred_at)` for the per-org timeline
 * query and `(type, name, occurred_at)` for the per-item history tab
 * Studio surfaces on the editor page.
 */
export const SysMetadataAuditObject = ObjectSchema.create({
  name: 'sys_metadata_audit',
  label: 'Metadata Audit',
  pluralLabel: 'Metadata Audit',
  icon: 'shield-check',
  isSystem: true,
  managedBy: 'append-only',
  // ADR-0057: compliance ledger for metadata changes — hot 365d, then
  // archive-then-delete. Without an 'archive' datasource rows are retained
  // forever (the Reaper never hot-deletes archive-declared objects).
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '365d' },
    archive: { after: '365d', to: 'archive' },
  },
  description: 'Append-only audit trail of metadata write decisions (ADR-0010).',

  fields: {
    /** Primary Key (UUID) */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    /** When the decision was made (ISO-8601 UTC). */
    occurred_at: Field.datetime({
      label: 'Occurred At',
      required: true,
      readonly: true,
    }),

    /** Acting principal (user id, system id, or 'system'). */
    actor: Field.text({
      label: 'Actor',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'Acting principal — user id, system id, or "system".',
    }),

    /** Code path that produced the decision (e.g. `protocol.saveMetaItem`). */
    source: Field.text({
      label: 'Source',
      required: false,
      readonly: true,
      maxLength: 128,
    }),

    /** Metadata type (singular, e.g. `app`, `object`, `view`). */
    type: Field.text({
      label: 'Metadata Type',
      required: true,
      readonly: true,
      searchable: true,
      maxLength: 100,
    }),

    /** Item machine name. */
    name: Field.text({
      label: 'Name',
      required: true,
      readonly: true,
      searchable: true,
      maxLength: 255,
    }),

    /** Organization for multi-tenant filtering. NULL for env-wide writes. */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
    }),

    /** Operation kind. */
    operation: Field.select(['save', 'publish', 'rollback', 'delete', 'reset'], {
      label: 'Operation',
      required: true,
      readonly: true,
    }),

    /** Decision outcome — allowed, denied (refused), or forced (bypassed via override). */
    outcome: Field.select(['allowed', 'denied', 'forced'], {
      label: 'Outcome',
      required: true,
      readonly: true,
    }),

    /**
     * Machine-readable code for the decision:
     *  - on `allowed`: `'ok'`
     *  - on `denied`: `'not_overridable'` | `'not_creatable'` |
     *    `'item_locked'` | `'invalid_metadata'` | `'destructive_change'` |
     *    `'metadata_conflict'`
     *  - on `forced`: `'lock_override'` (Phase 3)
     */
    code: Field.text({
      label: 'Code',
      required: true,
      readonly: true,
      maxLength: 64,
    }),

    /**
     * Lock state observed at the time of the decision (`none` if the
     * item carried no `_lock`). Captured even on `allowed` rows so
     * later compliance queries can see "what was the lock state when
     * this write succeeded".
     */
    lock_state: Field.select(['none', 'no-overlay', 'no-delete', 'full'], {
      label: 'Lock State',
      required: false,
      readonly: true,
    }),

    /** True when the write succeeded by bypassing a lock (Phase 3). */
    lock_overridden: Field.boolean({
      label: 'Lock Overridden',
      required: false,
      readonly: true,
    }),

    /** Optional request correlation id for tracing. */
    request_id: Field.text({
      label: 'Request ID',
      required: false,
      readonly: true,
      maxLength: 128,
    }),

    /** Optional free-form context (e.g. brief diff summary). */
    note: Field.textarea({
      label: 'Note',
      required: false,
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['organization_id', 'occurred_at'] },
    { fields: ['type', 'name', 'occurred_at'] },
    { fields: ['actor', 'occurred_at'] },
    { fields: ['outcome'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
