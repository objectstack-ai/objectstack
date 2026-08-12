// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_team_member — System Team Member Object
 *
 * Links users to teams within organizations.
 * Backed by better-auth's organization plugin (teams feature).
 *
 * @namespace sys
 */
export const SysTeamMember = ObjectSchema.create({
  name: 'sys_team_member',
  label: 'Team Member',
  pluralLabel: 'Team Members',
  icon: 'user-plus',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Team membership records linking users to teams',
  titleFormat: '{user_id} in {team_id}',
  highlightFields: ['user_id', 'team_id', 'created_at'],

  // Custom actions calling better-auth's team-member endpoints. Generic
  // CRUD is suppressed (managedBy: 'better-auth') so these are the
  // canonical add/remove entry points.
  actions: [
    {
      // Better-auth: `organization/add-team-member { teamId, userId }`.
      name: 'add_team_member',
      label: 'Add Member',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/add-team-member',
      // Team membership lives under organizations — multi-org-only. Gate
      // both mutations so they vanish in single-org (mirrors
      // sys_organization.create_organization).
      requiresFeature: 'organization',
      successMessage: 'Team member added',
      refreshAfter: true,
      params: [
        { name: 'teamId', field: 'team_id', required: true },
        { name: 'userId', field: 'user_id', required: true },
      ],
    },
    {
      // Better-auth: `organization/remove-team-member { teamId, userId }`.
      // The endpoint identifies the membership by the (teamId, userId)
      // pair rather than the join-row id, so we pull both from the row
      // via `defaultFromRow` instead of using `recordIdParam`.
      name: 'remove_team_member',
      label: 'Remove from Team',
      icon: 'user-minus',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/remove-team-member',
      requiresFeature: 'organization',
      // Confirm question on `description`, not `confirmText`: this action collects
      // params, and pairing the two keys opens two dialogs for one decision
      // (#7278 ruling 2026-08-10, swept by #7309).
      description: 'Remove this user from the team? They will lose any team-scoped access.',
      successMessage: 'Team member removed',
      refreshAfter: true,
      params: [
        { name: 'teamId', field: 'team_id', required: true, defaultFromRow: true },
        { name: 'userId', field: 'user_id', required: true, defaultFromRow: true },
      ],
    },
  ],

  fields: {
    id: Field.text({
      label: 'Team Member ID',
      required: true,
      readonly: true,
    }),
    
    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
    
    team_id: Field.lookup('sys_team', {
      label: 'Team',
      required: true,
    }),
    
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
    }),

    // better-auth's own single-column uniqueness boundary for a membership
    // (`teamMember.membershipKey`, added alongside `team.memberCount` in
    // 1.7.0-rc.1): a SHA-256 digest of [teamId, userId]. The organization
    // plugin writes it on every membership insert and relies on the UNIQUE
    // constraint to collapse concurrent adds — it catches the insert error
    // and re-reads the winner. Declared `input: false, returned: false`
    // upstream, so it never crosses the API boundary in either direction.
    // Nullable so legacy rows provisioned before the upgrade stay valid;
    // better-auth falls back to the (team_id, user_id) pair when the key
    // lookup misses. See #3624.
    membership_key: Field.text({
      label: 'Membership Key',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Derived membership digest maintained by better-auth; do not write directly.',
    }),
  },

  indexes: [
    { fields: ['team_id', 'user_id'], unique: true },
    { fields: ['user_id'] },
    // UNIQUE mirrors better-auth's own declaration — the constraint is what
    // makes its concurrent-add recovery work. Nullable columns admit repeated
    // NULLs on sqlite / postgres / mysql, so pre-upgrade rows are unaffected.
    { fields: ['membership_key'], unique: true },
  ],
  
  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
  },
});
