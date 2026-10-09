// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F, P } from '@objectstack/spec';

/**
 * sys_user_permission_set — User ↔ PermissionSet assignment.
 *
 * Salesforce-style additive permission grant: a user may be assigned any
 * number of `sys_permission_set` rows, optionally scoped to a specific
 * organization. The runtime resolver (`resolveExecutionContext` in
 * `@objectstack/runtime`) reads this table when building the per-request
 * `ExecutionContext.permissions[]`.
 *
 * Uniqueness is `(user_id, permission_set_id, organization_id)` so the
 * same permission set can be granted independently in each org context
 * the user belongs to.
 *
 * @namespace sys
 */
export const SysUserPermissionSet = ObjectSchema.create({
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  pluralLabel: 'User Permission Sets',
  icon: 'user-check',
  isSystem: true,
  // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema:
  // delegated `manageBindings` direct grants write this under the caller's
  // context. The bucket default is full CRUD, so no `userActions` block is
  // needed — the DelegatedAdminGate is the authz.
  managedBy: 'system-data',
  description: 'Direct assignment of a permission set to a user (optionally scoped to an organization).',
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // same two columns `titleFormat` names. With no pointer declared, the
  // registry's designate-only pass stamped `nameField: 'id'` (the first
  // title-eligible field), so a renderer honouring ADR-0079's order (an
  // explicit `nameField` wins over `titleFormat`) drew the raw id as the record
  // page's H1. `titleFormat` stays for renderers that still read it first;
  // `sys-security-assignment-display-title.test.ts` holds the two to the same text.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{user_id} → {permission_set_id}',
  highlightFields: ['user_id', 'permission_set_id', 'organization_id'],

  fields: {
    id: Field.text({
      label: 'Assignment ID',
      required: true,
      readonly: true,
      description: 'UUID of the assignment.',
    }),

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column. It reads only this row's own columns —
    // the two foreign keys, never a field of the looked-up records — and
    // neither is hidden, permission-guarded or masked on this object, so the
    // title carries nothing the declared read path withholds. Both are
    // required, so the expression needs no null guard.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.user_id + ' → ' + record.permission_set_id`,
      description: 'Record title: the user and the permission set assigned to them (computed on read)',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'Foreign key to sys_user.',
    }),

    permission_set_id: Field.lookup('sys_permission_set', {
      label: 'Permission Set',
      required: true,
      description: 'Foreign key to sys_permission_set.',
    }),

    // [ADR-0131 D4] The permission set this grant holds, BY NAME — the
    // reference the grant keeps once the id column above is dropped (D10).
    // System-written: `grant-permission-set-name.ts` derives it from
    // `permission_set_id` on every write that carries the id, for every caller,
    // and refuses a supplied value that names any other set (400
    // VALIDATION_FAILED, `invalid_value` here). Same width and shape as the
    // sibling assignment's `sys_user_position.position` (a `sys_*.name`, 100).
    // Not required: a grant written before this column existed carries NULL
    // until the backfill stage rewrites it. The grant readers of
    // plugin-security and plugin-auth read this column, and a grant with no
    // name grants nothing through them (`grantSetNameOf`); the resolver in
    // @objectstack/core still reads the id until its own stage switches it.
    permission_set: Field.text({
      label: 'Permission Set Name',
      required: false,
      readonly: true,
      maxLength: 100,
      description:
        '[ADR-0131 D4] Machine name of the permission set this grant holds (sys_permission_set.name). ' +
        'Written by the platform from permission_set_id on every write that carries it; a supplied value ' +
        'must equal that name or the write is refused. NULL on a grant written before the column existed.',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Optional organization scope. NULL = applies in every org context.',
    }),

    // Provenance, not a business link: the platform writes it, a caller does
    // not. A non-system insert is stamped with its writer by the
    // DelegatedAdminGate whatever the payload carried, and a system writer
    // (the organization-admin reconcile, the platform-admin promotion) keeps
    // the id or null it wrote (ADR-0118 D1 — never a sentinel). `readonly`
    // makes the update strip drop a non-system caller's value, and it is what
    // files a granter that no longer resolves under the integrity audit's
    // `provenance` bucket rather than as a broken business reference.
    granted_by: Field.lookup('sys_user', {
      label: 'Granted By',
      required: false,
      readonly: true,
      description: 'User who granted this permission set.',
    }),

    valid_from: Field.datetime({
      label: 'Valid From',
      required: false,
      description:
        '[ADR-0091 D1] Grant is inactive before this instant. Null = active immediately. ' +
        'Enforced fail-closed at resolution time (D2) — never by a background job.',
    }),

    valid_until: Field.datetime({
      label: 'Valid Until',
      required: false,
      description:
        '[ADR-0091 D1] Grant is inactive AT and AFTER this instant (half-open [from, until), UTC). ' +
        'Null = never expires. Mandatory on break-glass activations (D4) and agent grants (D6). ' +
        'Enforced at resolution time (D2).',
    }),

    reason: Field.text({
      label: 'Reason',
      required: false,
      maxLength: 500,
      description:
        '[ADR-0091 D1] Why this grant exists. Free text; REQUIRED on delegation (D3) and break-glass (D4) rows. ' +
        'Agent grants carry the task/run attribution here (D6).',
    }),

    // [#9730] `delegated_from` was RETIRED from this object (maintainer ruling
    // 2026-08-18, ADR-0049 enforce-or-remove). The runtime delegation gate is
    // structurally scoped to `sys_user_position` (`delegated-admin-gate.ts`
    // `isDelegationWrite`), so on THIS table the column was enforced at
    // authoring time only while staying data-door-writable — a declared-but-
    // unenforced surface on a security object, with zero producers measured
    // across packages/, apps/ and examples/. The sibling declaration on
    // `sys_user_position` is untouched and fully enforced (gate + explain
    // engine + lint). If delegation at permission-set granularity ever becomes
    // a real need, it is re-declared WITH a runtime reader in the same PR —
    // declare-and-enforce or don't declare. A write that still carries the key
    // is refused loudly by the engine's schema preflight (400 INVALID_FIELD).
    // Ledger: `ups-delegated-from-column-retired` (ADR-0087 semantic entry).

    // [#9046] ADR-0091 D5 calls these two columns the recertification
    // "substrate", and they are exactly that and nothing more. A whole-tree
    // sweep (packages/, apps/, examples/, every .ts/.tsx, tests included)
    // finds the pair in two kinds of place only: these declarations and the
    // generated i18n bundles that carry their strings. No producer, no
    // consumer - nothing stamps them, nothing reads them, and no surface
    // derives "never certified" or "certification stale". Their siblings on
    // this object are not like that in the same way: valid_from/valid_until
    // are enforced by isGrantActive at resolution time, and `reason` is
    // stamped by the platform's own writer (auto-org-admin-grant provenance).
    // (`delegated_from` used to be listed here too — it was retired from this
    // object, see the [#9730] note above.)
    //
    // The old descriptions ("When this grant was last attested in a
    // recertification review", "Reviewer who last attested this grant") stated
    // D5's intent as though it were the behavior. Access recertification is a
    // compliance control (SOX / ISO 27001 access review), so that misreading
    // is the expensive kind: an admin walking these objects - or an AI agent
    // authoring against this model - takes a populated "Last Certified At" as
    // evidence of a review the platform never performed and never checked.
    //
    // ADR-0049 enforce-or-remove, settled the way sys_capability.active was
    // (maintainer ruling, 2026-08-13): building the review workflow is a
    // designed feature with no measured pull, and dropping shipped columns
    // costs a migration over existing rows while buying nothing the prose fix
    // does not - the harm here is the promise, not the storage. So the claim
    // is withdrawn, and the descriptions state the inertness outright rather
    // than merely omitting the promise: a reader who remembers the old wording
    // has to be told it was wrong, not left to infer it. If D5 is ever
    // implemented, these two descriptions are what must change with it.
    last_certified_at: Field.datetime({
      label: 'Last Certified At',
      required: false,
      description:
        '[ADR-0091 D5] Reserved for a future access-recertification workflow, which would stamp here when this grant was last attested. ' +
        'Inert today: no platform code writes this column and none reads it — no resolution path, gate or lint consults it, and nothing derives ' +
        '"never certified" or "certification stale" from it. Null therefore means the workflow does not exist, not that this grant went unreviewed.',
    }),

    certified_by: Field.lookup('sys_user', {
      label: 'Certified By',
      required: false,
      description:
        '[ADR-0091 D5] Reserved for the same future access-recertification workflow: the reviewer who would attest this grant. ' +
        'Inert today: no platform code writes or reads it. A value written here by a client is an unverified annotation — ' +
        'the platform checks nothing about it and grants nothing on the strength of it.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  // [ADR-0091 D1/D2] The validity window is half-open, `[valid_from,
  // valid_until)`, so a window whose end is not after its start is EMPTY: the
  // resolver drops the assignment at every evaluation and it grants nothing,
  // ever. Stored without a word, a mistyped date became a grant that silently
  // granted nothing; refusing it at the write tells the administrator.
  //
  // Declared, not a hook: the engine evaluates an object's validation rules on
  // every write path — insert (single and batch) and update (by id, and per
  // matched row of a multi-row update), for system and non-system writers
  // alike — against the stored row overlaid with the patch.
  //
  // ⛔ A declared rule is an INVARIANT by default: it would refuse ANY edit to a
  // row that already violates. The `previous` clause narrows it to the writes
  // that make the window: an insert (`previous` is null there), or an update
  // that moves a bound. An assignment stored before this rule existed with an
  // inverted window keeps taking unrelated edits; the write that repairs it is
  // the only one that has to state a valid window.
  //
  // `datetime()` compares instants, not spellings: two ISO strings for one
  // instant (`…:00Z`, `…:00.000Z`) compare equal, which a string comparison
  // would not. `cross_field` so the violation attaches to `valid_until`, where
  // a form shows it.
  validations: [
    {
      type: 'cross_field',
      name: 'validity_window_order',
      label: 'Validity window ends after it starts',
      description:
        '[ADR-0091 D1/D2] A grant is active in the half-open window [valid_from, valid_until), so a window that '
        + 'ends at or before it starts grants nothing. Judged on insert, and on an update that moves a bound.',
      fields: ['valid_until', 'valid_from'],
      condition: P`(previous == null || record.valid_from != previous.valid_from || record.valid_until != previous.valid_until) && record.valid_from != null && record.valid_until != null && datetime(record.valid_until) <= datetime(record.valid_from)`,
      severity: 'error',
      message:
        'Valid Until must be later than Valid From. The grant is active from Valid From up to, but not including, '
        + 'Valid Until, so a window that ends at or before it starts grants nothing. Leave either one empty for an open-ended window.',
    },
  ],

  indexes: [
    { fields: ['user_id', 'permission_set_id', 'organization_id'], unique: 'global' },
    { fields: ['user_id'] },
    { fields: ['organization_id'] },
    { fields: ['permission_set_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // `bulk` = the batch shape of the verbs above; the gate is `bulk ∧ child`
    // (#3391 P1), so omitting it 405s /batch and the *Many routes (#3026).
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});
