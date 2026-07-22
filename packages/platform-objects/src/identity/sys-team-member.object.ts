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
      confirmText: 'Remove this user from the team? They will lose any team-scoped access.',
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
  },
  
  indexes: [
    { fields: ['team_id', 'user_id'], unique: true },
    { fields: ['user_id'] },
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
