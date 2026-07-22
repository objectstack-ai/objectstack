// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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
  managedBy: 'system',
  // [ADR-0103] Admin/user-writable DATA on a platform-defined schema: delegated
  // "add position" writes this under the caller's context. Affordance only —
  // the DelegatedAdminGate is the authz; opening it here keeps the system write
  // guard from rejecting the legitimate write.
  userActions: { create: true, edit: true, delete: true },
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

    last_certified_at: Field.datetime({
      label: 'Last Certified At',
      required: false,
      description:
        '[ADR-0091 D5] When this grant was last attested in a recertification review. Null = never certified.',
    }),

    certified_by: Field.lookup('sys_user', {
      label: 'Certified By',
      required: false,
      description: '[ADR-0091 D5] Reviewer who last attested this grant.',
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
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },
});
