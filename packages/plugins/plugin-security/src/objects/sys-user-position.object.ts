// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { reservedIdentityNamesCelList, reservedIdentityNameMessage } from './reserved-identity-names.js';

/**
 * sys_user_position — User ↔ Position assignment (ADR-0057 D4).
 *
 * The platform-owned source of truth for "who holds which position"
 * (ADR-0090 D3; formerly sys_user_role), decoupled from better-auth's
 * `sys_member.role` (org-administration tier). At request time the runtime
 * resolver (`resolveExecutionContext`) reads assignments from this table
 * (∪ `sys_member.role` during the transition window) into
 * `ExecutionContext.positions[]`.
 *
 * `position` stores the position's machine name (matches
 * `sys_position.name`), mirroring how `ctx.positions` is keyed everywhere
 * downstream. `organization_id = null` means a cross-tenant (global)
 * assignment.
 *
 * `business_unit_id` is the ASSIGNMENT-LEVEL BU anchor (ADR-0090 Addendum;
 * reserved by ADR-0057 D4). Positions never bind to a business unit at the
 * definition level — that recreates the position-per-department explosion.
 * The anchor has exactly three consumers: the depth anchor for this
 * assignment's readScope/writeScope (enterprise hierarchy resolver), the
 * ADR-0090 D12 delegated-administration boundary ("assignments you create
 * must target your subtree" — enforced by the delegated-admin gate), and the
 * audit fact ("manager OF WHAT"). Capability bits are never BU-scoped.
 *
 * @namespace sys
 */
export const SysUserPosition = ObjectSchema.create({
  name: 'sys_user_position',
  label: 'User Position',
  pluralLabel: 'User Positions',
  icon: 'user-cog',
  isSystem: true,
  // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema:
  // delegated "add position" writes this under the caller's context. The bucket
  // default is full CRUD, so no `userActions` block is needed — the affordance is
  // a declaration only; the DelegatedAdminGate is the authz.
  managedBy: 'system-data',
  description: 'Assigns a position (sys_position.name) to a user. Platform-owned (ADR-0057 D4, ADR-0090 D3).',
  titleFormat: '{user_id} → {position}',
  highlightFields: ['user_id', 'position', 'business_unit_id', 'organization_id'],

  fields: {
    id: Field.text({
      label: 'Assignment ID',
      required: true,
      readonly: true,
      description: 'UUID of the user-position assignment.',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'Foreign key to sys_user.',
    }),

    position: Field.text({
      label: 'Position',
      required: true,
      maxLength: 100,
      description: 'Position machine name (references sys_position.name).',
    }),

    business_unit_id: Field.lookup('sys_business_unit', {
      label: 'Business Unit',
      required: false,
      description:
        '[ADR-0090 Addendum] Assignment-level BU anchor: where this position assignment applies. ' +
        'Depth anchor for readScope/writeScope, delegated-admin boundary (D12), and audit fact. ' +
        'Null = unanchored (legacy/tenant-wide); delegated admins MUST anchor assignments inside their subtree.',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Tenant that owns this assignment; null = global (cross-tenant).',
    }),

    granted_by: Field.lookup('sys_user', {
      label: 'Granted By',
      required: false,
      description: 'User who granted this position assignment (stamped by the delegated-admin gate for delegate writes).',
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
        'Null = never expires. Mandatory on delegation rows (D3). Enforced at resolution time (D2).',
    }),

    reason: Field.text({
      label: 'Reason',
      required: false,
      maxLength: 500,
      description:
        '[ADR-0091 D1] Why this grant exists. Free text; REQUIRED on delegation (D3) and break-glass (D4) rows.',
    }),

    delegated_from: Field.lookup('sys_user', {
      label: 'Delegated From',
      required: false,
      description:
        '[ADR-0091 D3] The delegator whose authority this row carries (职务代理). ' +
        'A row with delegated_from set is not itself delegatable and not self-renewable — chains are cut both ways.',
    }),

    // [#9046] The same declared-but-inert D5 pair as on
    // sys_user_permission_set, with the same disposition. The whole-tree sweep
    // finds these two columns in the two declarations and the generated i18n
    // bundles and nowhere else: nothing writes them, nothing reads them, no
    // surface derives "never certified" or "certification stale" - while
    // valid_from/valid_until (isGrantActive) and reason/delegated_from (the
    // delegated-admin gate, the security-posture lint) on this same object all
    // resolve to real enforcement. The old descriptions stated D5's intent as
    // though it were the behavior, which on a compliance surface reads as
    // evidence of an access review that never happened. ADR-0049
    // enforce-or-remove, settled as sys_capability.active was (maintainer
    // ruling, 2026-08-13): the claim is withdrawn in prose rather than the
    // workflow built or the columns dropped. Full rationale sits with the
    // sibling declaration in sys-user-permission-set.object.ts.
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
    { fields: ['user_id', 'position', 'organization_id'], unique: true },
    { fields: ['user_id'] },
    { fields: ['position'] },
    { fields: ['business_unit_id'] },
    { fields: ['organization_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // `bulk` = the batch shape of the verbs above; the gate is `bulk ∧ child`
    // (#3391 P1), so omitting it 405s /batch and the *Many routes (#3026).
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },

  // ── [#15972] Reserved built-in identity names ────────────────────
  //
  // THE ROW IS THE EXPOSURE. `position` is free text (it references
  // `sys_position.name` by convention, not by lookup), this object is
  // `apiEnabled`, and its bucket is admin/user-writable — so refusing the
  // reserved names on the position DEFINITION alone closes nothing here: the
  // platform seeds a `platform_admin` catalog row in every organization, and
  // an assignment row may name it (or any built-in identity) with no
  // definition needed at all.
  //
  // Nothing legitimate writes one. The built-in identities are a PROJECTION
  // with their own sources of truth — the unscoped `admin_full_access` grant
  // for `platform_admin` (`bootstrapPlatformAdmin` writes a
  // `sys_user_permission_set` row, never one of these), `sys_member.role` for
  // the `org_*` trio — and the resolver unions those in itself. So an
  // assignment row spelling one of these names is, in every case, a name
  // pretending to be an identity, and the refusal takes no provenance
  // exemption: unlike `sys_position`, this object has no legitimate seeder to
  // exempt.
  //
  // The invariant core's own resolver states from the other side, in a comment
  // (`resolve-authz-context.ts`): «Read the RUNG — never
  // `positions.includes(...)`; an ADR-0057 D4 `sys_user_position` row may spell
  // that very name.» ⚠️ That comment was there the whole time and prevented
  // nothing. This is the same sentence, on the write path, where it can refuse.
  validations: [
    {
      // `script`, not `cross_field`: one column decides it, and this variant's
      // strict shape carries no `fields`, so the violation attaches to
      // `_record`. The message names the column.
      type: 'script',
      name: 'reserved_identity_position',
      label: 'Reserved built-in identity name',
      description:
        'ADR-0068 D2 built-in identity names are a projection with their own sources of truth. A stored '
        + 'assignment row spelling one grants nothing and misrepresents the holder, so it is refused.',
      condition: { dialect: 'cel', source: `record.position in ${reservedIdentityNamesCelList()}` },
      severity: 'error',
      message: reservedIdentityNameMessage('position'),
    },
  ],
});
