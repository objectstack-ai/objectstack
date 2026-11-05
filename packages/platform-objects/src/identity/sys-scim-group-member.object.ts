// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F } from '@objectstack/spec/shared';

/**
 * sys_scim_group_member — SCIM group membership junction
 * (`@better-auth/scim` stable `scimGroupMember`).
 *
 * One row per (group, member) pair the IdP pushes. The name survives from
 * rc.1 but the anchoring is the stable rewrite's: the member references the
 * per-connection `sys_scim_user` projection (`scim_user_id`), not the core
 * user table. Columns mirror the installed stable schema, bridged mechanically
 * camelCase → snake_case by `objectql-adapter.ts` (see
 * `better-auth-schema-parity.test.ts`, #3653).
 *
 * @namespace sys
 */
export const SysScimGroupMember = ObjectSchema.create({
  name: 'sys_scim_group_member',
  label: 'SCIM Group Member',
  pluralLabel: 'SCIM Group Members',
  icon: 'users',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/scim) — see ADR-0134.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'SCIM group membership rows pushed by the IdP (group ↔ provisioned user)',
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // columns `titleFormat` named. With no pointer declared, the registry's
  // designate-only pass stamped `nameField: 'id'` (the first title-eligible
  // field), so a renderer honouring ADR-0079's order (an explicit `nameField`
  // wins over `titleFormat`) drew the raw id as the record page's H1. The
  // retired `titleFormat` template beside it is gone (refused at save and by
  // `os validate`); `identity-display-title.test.ts` holds the formula to the
  // text that template drew. The formula names the provisioned user and the
  // group, each read one hop through its lookup (ADR-0079 addendum
  // 2026-10-18), never the stored ids.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['group_id', 'scim_user_id', 'created_at'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_scim_group_member' },
      columns: ['group_id', 'scim_user_id', 'connection_id', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  // [ADR-0095 D1, 2026-10-18 note] This object's default row scope: the one policy
  // plugin-security's shipped permission sets used to spread for it, moved here
  // verbatim; the sets no longer carry a copy (#24164 ruling E′ item 3's follow-up).
  // Layer 0 is inert on this table (no organization column), so Layer 1 silence means
  // this scope, not no filter. The security plugin's row-policy collection applies it
  // when no set the caller holds carries a row policy for the object and operation —
  // so to every shipped set's holder, whose reads and explain name this scope. An
  // `extend` contribution cannot set or loosen it (refused at registration).
  defaultRowScope: {
    name: 'sys_scim_group_member_none',
    operation: 'select',
    using: 'id == null',
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column. It names the provisioned user and the
    // group by each one's own title, read ONE hop through its lookup (ADR-0079
    // addendum, 2026-10-18): `sys_scim_user.user_name` and
    // `sys_scim_group.display_name`, both required stored text (no second hop,
    // no null guard). Both hops are read under the READER's own authority: a
    // row the reader may not read, or one that no longer exists, leaves the
    // title null, never an id.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.scim_user_id.user_name + ' in ' + record.group_id.display_name`,
      description: 'Record title: the provisioned user and the group (computed on read)',
      group: 'Membership',
    }),

    connection_id: Field.text({
      label: 'Connection ID',
      required: true,
      maxLength: 255,
      group: 'Connection',
    }),

    group_id: Field.lookup('sys_scim_group', {
      label: 'Group',
      required: true,
      group: 'Membership',
    }),

    scim_user_id: Field.lookup('sys_scim_user', {
      label: 'SCIM User',
      required: true,
      group: 'Membership',
    }),

    membership_key: Field.text({
      label: 'Membership Key',
      required: true,
      readonly: true,
      maxLength: 512,
      description: 'Derived membership uniqueness key maintained by @better-auth/scim; do not write directly.',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', readonly: true, group: 'System' }),
  },

  indexes: [
    // UNIQUE mirrors @better-auth/scim's own declaration — what makes its
    // concurrent-add recovery work (same shape as sys_team_member).
    { fields: ['membership_key'], unique: 'global' },
    { fields: ['group_id'] },
    { fields: ['scim_user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
