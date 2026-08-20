// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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
  titleFormat: '{user_id} → {permission_set_id}',
  highlightFields: ['user_id', 'permission_set_id', 'organization_id'],

  fields: {
    id: Field.text({
      label: 'Assignment ID',
      required: true,
      readonly: true,
      description: 'UUID of the assignment.',
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

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Optional organization scope. NULL = applies in every org context.',
    }),

    granted_by: Field.lookup('sys_user', {
      label: 'Granted By',
      required: false,
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

  indexes: [
    { fields: ['user_id', 'permission_set_id', 'organization_id'], unique: true },
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
