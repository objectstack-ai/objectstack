// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_record_share — Per-Record Sharing Grant
 *
 * Bridges the ownership-only baseline established by `object.sharingModel`
 * with the real-world need to delegate access to a single record. Each
 * row says: "principal P has access level L on (object O, record R),
 * because of source S (manual grant or rule)."
 *
 * Enforcement lives in `@objectstack/plugin-sharing`:
 *   - For objects with `sharingModel: 'private'`, the engine middleware
 *     AND-s `{$or:[{owner_id:userId},{id:{$in:[grantedRecordIds]}}]}`
 *     into every `find` against that object.
 *   - For objects with `sharingModel: 'private' | 'read'`, the same
 *     middleware enforces edit/delete by checking ownership OR a share
 *     row with `access_level in ('edit','full')`. `full` is no longer
 *     authorable (#3865 — it never granted more than `edit`); the gates
 *     keep matching it so not-yet-normalised rows stay honoured.
 *
 * Conventions:
 *  - `object_name` is the short object name (e.g. `account`, `lead`).
 *  - `recipient_type` mirrors `RecordShareRecipientType` from
 *    `@objectstack/spec/contracts` (`user` is enforced today;
 *    `group`/`position` are persisted for forward-compatibility).
 *  - `source = 'manual'` rows are created by a user via the REST
 *    `POST /data/:object/:id/shares` endpoint. `source = 'rule'` rows
 *    are materialised by the sharing-rule evaluator (future); the
 *    `source_id` lets the evaluator reconcile stale grants.
 *
 * @namespace sys
 */
export const SysRecordShare = ObjectSchema.create({
  name: 'sys_record_share',
  label: 'Record Share',
  pluralLabel: 'Record Shares',
  icon: 'share',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Per-record sharing grant — extends OWD with explicit access',
  titleFormat: '{object_name}/{record_id} → {recipient_id} ({access_level})',
  highlightFields: ['object_name', 'record_id', 'recipient_id', 'access_level', 'source'],

  listViews: {
    granted_to_me: {
      type: 'grid',
      name: 'granted_to_me',
      label: 'Granted to Me',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'access_level', 'source', 'granted_by', 'created_at'],
      filter: [
        { field: 'recipient_type', operator: 'equals', value: 'user' },
        { field: 'recipient_id', operator: 'equals', value: '{current_user_id}' },
      ],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    granted_by_me: {
      type: 'grid',
      name: 'granted_by_me',
      label: 'Granted by Me',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'recipient_id', 'access_level', 'source', 'created_at'],
      filter: [
        { field: 'granted_by', operator: 'equals', value: '{current_user_id}' },
      ],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    by_object: {
      type: 'grid',
      name: 'by_object',
      label: 'By Object',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'recipient_id', 'access_level', 'source', 'created_at'],
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'created_at', order: 'desc' }],
      grouping: { fields: [{ field: 'object_name', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    manual_grants: {
      type: 'grid',
      name: 'manual_grants',
      label: 'Manual Grants',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'recipient_id', 'access_level', 'granted_by', 'reason', 'created_at'],
      filter: [{ field: 'source', operator: 'equals', value: 'manual' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    rule_grants: {
      type: 'grid',
      name: 'rule_grants',
      label: 'Rule Grants',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'recipient_id', 'access_level', 'source_id', 'created_at'],
      filter: [{ field: 'source', operator: 'in', value: ['rule', 'team', 'inherited'] }],
      sort: [{ field: 'source_id', order: 'asc' }, { field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_shares: {
      type: 'grid',
      name: 'all_shares',
      label: 'All',
      data: { provider: 'object', object: 'sys_record_share' },
      columns: ['object_name', 'record_id', 'recipient_type', 'recipient_id', 'access_level', 'source', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Share ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Target (which record is being shared) ────────────────────
    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      description: 'Short object name of the shared record',
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record',
      required: true,
      maxLength: 100,
      description: 'Primary key of the shared record within object_name',
      // [#11386] The id half of this object's pointer pair (ADR-0052 §5),
      // adopting the #11339 carrier. VERIFIED for THIS object: the pair is
      // dereferenced as a real record address, not stored as a label —
      // `record-orphan-cleanup.ts` states the invariant for both tables in
      // this package ("record gone ⇒ the row cannot describe any access at
      // all") and sweeps rows by asking, per row, whether `(object_name,
      // record_id)` still exists; `sharing-service.ts` writes it from
      // `input.object` / `input.recordId` and gates management on the same
      // pair.
      //
      // Consequence of declaring, and why it matters MORE on a grant table
      // than on a log: an unresolved verbatim `record_id` did not merely fail
      // to display. It named no live record, so it enforced no access while
      // showing on Setup → Record Shares as though it did — and the orphan
      // sweep then DELETED the row for describing a record that does not
      // exist. Loud seed-time refusal replaces a grant that silently meant
      // nothing and then silently disappeared.
      group: 'Target',
      //
      // ⚠️ ORDERING CONSTRAINT — this id half is `required: true`, and that
      // makes it ORDER-DEPENDENT in seeds even though a pointer pair
      // contributes no static ordering edge (#11674, measured against the real
      // engine in `packages/objectql/src/engine-seed-required-deferral.test.ts`):
      // the seed loader defers an unresolvable reference by DELETING the column
      // from the pass-1 insert, required-validation rejects that row, and pass 2
      // is then left with no row to back-fill. So the pass-2 healing that makes
      // an OPTIONAL id half order-independent (`sys_audit_log`) does not reach
      // this one. ⇒ SEED THE TARGET DATASET FIRST. The failure if you do not is
      // loud in three places — a write error naming this column, a
      // dropped-deferral error, and `success: false` — and since #11674 the
      // loader also WARNS at load time, before the engine rejects the row.
      referenceVia: 'object_name',
    }),

    // ── Recipient (who receives access) ──────────────────────────
    recipient_type: Field.select(
      ['user', 'group', 'position', 'unit_and_subordinates', 'guest'],
      {
        label: 'Recipient Type',
        required: true,
        defaultValue: 'user',
        description: 'Kind of principal that holds the grant',
        group: 'Recipient',
      },
    ),

    recipient_id: Field.text({
      label: 'Recipient',
      required: true,
      maxLength: 100,
      description: 'ID of the user/group/position that receives access',
      group: 'Recipient',
    }),

    access_level: Field.select(
      // `full` ("Full Access — transfer/share/delete") was removed: no code
      // path granted any of those verbs because of it — the read and write
      // gates matched `access_level in ('edit','full')`, making it identical to
      // `edit` while claiming more (ADR-0078 declared-but-unenforced; #3865).
      // Rows persisted with `full` are normalised to `edit` (grant-time + boot
      // backfill) and stay honoured by the gates until they are.
      ['read', 'edit'],
      {
        label: 'Access Level',
        required: true,
        defaultValue: 'read',
        description: 'What the recipient can do — read, or read and edit',
        group: 'Recipient',
      },
    ),

    // ── Provenance ───────────────────────────────────────────────
    source: Field.select(
      ['manual', 'rule', 'team', 'inherited'],
      {
        label: 'Source',
        required: true,
        defaultValue: 'manual',
        description: 'Why this grant exists — used by the rule evaluator to reconcile',
        group: 'Provenance',
      },
    ),

    source_id: Field.text({
      label: 'Source ID',
      required: false,
      maxLength: 200,
      description: 'Rule name / team id when source != manual',
      group: 'Provenance',
    }),

    granted_by: Field.lookup('sys_user', {
      label: 'Granted By',
      required: false,
      description: 'User that created the grant (manual only)',
      group: 'Provenance',
    }),

    reason: Field.text({
      label: 'Reason',
      required: false,
      maxLength: 500,
      description: 'Optional free-text explanation surfaced to the recipient',
      group: 'Provenance',
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
    // Hot path: "all records visible to user U on object O" — the
    // middleware reads (object_name, recipient_type, recipient_id) to
    // build the `id IN (...)` predicate on every find.
    { fields: ['object_name', 'recipient_type', 'recipient_id'] },
    // "all grants on this record" — used by the share-management UI
    // and by canEdit() to look up explicit grants.
    { fields: ['object_name', 'record_id'] },
    // Reconciliation key for rule-driven shares.
    { fields: ['source', 'source_id'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: materialized only by the sharing engine
    // (SYSTEM_CTX), never via the generic data API. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
