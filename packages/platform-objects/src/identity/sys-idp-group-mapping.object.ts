// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PLATFORM_ADMIN_SETTINGS_GATE } from './platform-admin-action-gate.js';

/**
 * sys_idp_group_mapping — which permission set an identity provider's group
 * grants (ADR-0134 D4's group seam, filled for permission sets only).
 *
 * One row says: a member of THIS group, sent by THIS source, holds THIS
 * permission set in THIS organization. The source is a SCIM connection
 * (`source_kind: 'scim'`, `source_id` = the connection id the bearer verifies
 * as) or an SSO provider whose sign-in carries the user's groups as a claim
 * (`source_kind: 'sso'`, `source_id` = the provider id): one mapping model for
 * both, never a second one.
 *
 * Who writes it: the platform administrator, through plugin-auth's
 * `/admin/scim/set-group-mapping` and `/admin/scim/delete-group-mapping`
 * mounts — the same gate as the SCIM credential door (ADR-0068 D2) — which
 * Setup reaches through the declared actions below. The data API is list-only
 * (`apiMethods` below), so no other writer exists. The door
 * refuses, at save, a permission set outside the organization boundary
 * (plugin-security's `organizationBoundaryFailure`: the administrator sets,
 * the agent ceilings, superuser wildcards, an `adminScope`, a capability not
 * scoped to the organization): an identity provider's group never confers
 * administrator standing.
 *
 * Who reads it: the SCIM `projection` (`scim-group-projection.ts`) when a
 * group's membership changes, and the SSO sign-in (`sso-group-projection.ts`)
 * on every sign-in through the provider. A group is matched by its
 * `externalId` (for SSO: a claim value equal to it) when the row names one,
 * else by its `displayName`; the row names exactly one.
 *
 * Whether the row matches anything now: `match_status`, `matched_group_id` and
 * `match_changed_at` say whether a group its SCIM connection currently pushes
 * (`sys_scim_group`) is the one the row names, so a console can show a mapping
 * that matches no current group (renamed or deleted at the identity provider),
 * which grants nothing. plugin-auth keeps them current on every write to either
 * side (`idp-group-mapping-match.ts`, engine hooks on `sys_scim_group` and on
 * this object); nothing else writes them. An SSO provider sends its groups only
 * as a sign-in claim and stores no group list, so an SSO row reads
 * `not_applicable`. They describe the row; they never decide a grant.
 *
 * @namespace sys
 */
export const SysIdpGroupMapping = ObjectSchema.create({
  name: 'sys_idp_group_mapping',
  label: 'IdP Group Mapping',
  pluralLabel: 'IdP Group Mappings',
  icon: 'users',
  isSystem: true,
  // plugin-auth's admin door is the only writer; no user CRUD, no better-auth model.
  managedBy: 'engine-owned',
  // [ADR-0066 D3] Admin-only identity configuration, the same object-level
  // capability gate as the SCIM credential store beside it.
  requiredPermissions: ['manage_platform_settings'],
  protection: {
    lock: 'full',
    reason: 'ObjectStack-owned identity-provider group mapping — written only through the platform-admin SCIM door.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Maps an identity provider group to the permission set its members are granted',
  displayNameField: 'permission_set',
  nameField: 'permission_set', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['source_id', 'group_external_id', 'group_display_name', 'permission_set'],

  // Add and remove a mapping from Setup. All three actions forward to
  // plugin-auth's two platform-admin mounts (`idp-group-mapping-admin.ts`),
  // the mapping's only door: the data API stays list-only (`apiMethods`
  // below), so no action writes a row itself, and `protection.lock: 'full'`
  // keeps every generic create, edit and delete closed. The mounts run the
  // shared platform-admin gate (ADR-0068 D2) and answer everyone else 403, so
  // each action is offered only on the rung that door admits
  // (`current_user.isPlatformAdmin == true`, ADR-0068 D4) and declares the
  // door's gate where both action doors read it (`requiredPermissions`). ⛔ Who
  // may map a group is the door's decision: these declarations narrow who is
  // OFFERED the button to who the door already admits, and never widen it.
  //
  // Every refusal is the door's own sentence, shown by the console as the
  // action's error with the dialog still open: a permission set outside the
  // organization boundary (`400 VALIDATION_FAILED` on `permissionSet`), a
  // same-group mapping left in another organization (`409 RESOURCE_CONFLICT`,
  // naming the mapping to delete first), SCIM, SSO or the security service
  // absent (`503`), an unknown mapping on delete (`404`).
  //
  // The save takes exactly one source, so there is one action per source kind:
  // `providerId` (an SSO provider) or `connectionId` (a SCIM connection), each
  // required in its own dialog. The group is named by `groupExternalId` or
  // `groupDisplayName`, exactly one: both are optional params here and the door
  // refuses neither-or-both with its own sentence. The params are named for the
  // body keys the mount reads, not for the row's columns.
  //
  // ADR-0011 identity-actions note: these postdate its assessment and are in no
  // bucket, so, like the other unassessed identity actions, they declare no
  // `ai` block (human-only) until a maintainer ruling assesses them.
  actions: [
    {
      name: 'map_sso_group',
      label: 'Map SSO Group',
      icon: 'plus-circle',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/scim/set-group-mapping',
      // The door's platform-admin gate, declared where both action doors read it.
      requiredPermissions: [...PLATFORM_ADMIN_SETTINGS_GATE],
      visible: 'current_user.isPlatformAdmin == true',
      description: 'Grant a permission set to every member of a group an SSO provider sends at sign-in. It applies at each member\'s next sign-in through the provider.',
      successMessage: 'Group mapping saved. It applies at each member\'s next sign-in through the provider.',
      refreshAfter: true,
      params: [
        {
          name: 'providerId',
          label: 'SSO Provider ID',
          type: 'text',
          required: true,
          helpText: 'The Provider ID of the SSO provider whose sign-in carries the group, e.g. "okta". The provider must have a groups claim (Edit Groups Claim on the SSO provider).',
        },
        {
          name: 'groupExternalId',
          label: 'Group External ID',
          type: 'text',
          required: false,
          helpText: 'The group value exactly as the groups claim sends it when that is an ID, e.g. an Entra ID group object ID. Set this or Group Display Name, not both.',
        },
        {
          name: 'groupDisplayName',
          label: 'Group Display Name',
          type: 'text',
          required: false,
          helpText: 'The group value exactly as the groups claim sends it when that is a name, e.g. "Sales". Set this or Group External ID, not both.',
        },
        {
          name: 'permissionSet',
          label: 'Permission Set',
          type: 'text',
          widget: 'permission-ref',
          required: true,
          helpText: 'The permission set a member of the group is granted, in the provider\'s organization. Administrator sets are refused.',
        },
      ],
    },
    {
      name: 'map_scim_group',
      label: 'Map SCIM Group',
      icon: 'plus-circle',
      variant: 'secondary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/scim/set-group-mapping',
      // The door's platform-admin gate, declared where both action doors read it.
      requiredPermissions: [...PLATFORM_ADMIN_SETTINGS_GATE],
      visible: 'current_user.isPlatformAdmin == true',
      description: 'Grant a permission set to every member of a group a SCIM connection provisions. The group\'s current members are granted it now.',
      successMessage: 'Group mapping saved',
      refreshAfter: true,
      params: [
        {
          name: 'connectionId',
          label: 'SCIM Connection ID',
          type: 'text',
          required: true,
          helpText: 'The SCIM connection the group is provisioned through, e.g. "okta-prod": the Connection ID of its credential.',
        },
        {
          name: 'groupExternalId',
          label: 'Group External ID',
          type: 'text',
          required: false,
          helpText: 'The group\'s externalId as the identity provider sends it. Set this or Group Display Name, not both.',
        },
        {
          name: 'groupDisplayName',
          label: 'Group Display Name',
          type: 'text',
          required: false,
          helpText: 'The group\'s displayName, matched exactly. Set this or Group External ID, not both.',
        },
        {
          name: 'permissionSet',
          label: 'Permission Set',
          type: 'text',
          widget: 'permission-ref',
          required: true,
          helpText: 'The permission set a member of the group is granted, in the connection\'s organization. Administrator sets are refused.',
        },
      ],
    },
    // The mount answers 404 for an unknown mapping. What a delete takes away
    // depends on the source, and the confirmation says both: a SCIM mapping
    // re-projects the connection, so the grants it made go; an SSO mapping
    // removes at once the grants its provider projected for that set, unless
    // another of the provider's mappings still names it.
    {
      name: 'delete_group_mapping',
      label: 'Delete Mapping',
      icon: 'trash-2',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/scim/delete-group-mapping',
      recordIdParam: 'mappingId',
      // The door's platform-admin gate, declared where both action doors read it.
      requiredPermissions: [...PLATFORM_ADMIN_SETTINGS_GATE],
      visible: 'current_user.isPlatformAdmin == true',
      confirmText: 'Delete this group mapping? The group\'s members stop being granted its permission set. For a SCIM connection, the group\'s members are re-projected now and lose the grants this mapping made. For an SSO provider, the grants its sign-ins made for this set are removed now, unless another of the provider\'s mappings names the same set. To restore it, map the group again.',
      successMessage: 'Group mapping deleted',
      refreshAfter: true,
    },
  ],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_idp_group_mapping' },
      columns: ['source_kind', 'source_id', 'group_external_id', 'group_display_name', 'permission_set', 'organization_id', 'match_status'],
      sort: [{ field: 'source_id', order: 'asc' }],
      pagination: { pageSize: 50 },
      // Per-object empty state: the engine-owned bucket's shared copy ("entries
      // appear automatically when their source action runs") is false here,
      // where a platform administrator adds each row with the actions above.
      emptyState: {
        title: 'No group mappings yet',
        message: 'Grant a permission set to the members of an identity provider group with “Map SSO Group” (a group an SSO provider sends at sign-in) or “Map SCIM Group” (a group a SCIM connection provisions).',
        icon: 'users',
      },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    source_kind: Field.select({
      label: 'Source Kind',
      required: true,
      defaultValue: 'scim',
      description: 'What sends the group: a SCIM connection, or an SSO provider at sign-in.',
      group: 'Source',
      options: [
        { value: 'scim', label: 'SCIM Connection' },
        { value: 'sso', label: 'SSO Provider' },
      ],
    }),

    source_id: Field.text({
      label: 'Source ID',
      required: true,
      maxLength: 255,
      description: 'The SCIM connection ID or the SSO provider ID the group arrives through, e.g. "okta-prod".',
      group: 'Source',
    }),

    group_external_id: Field.text({
      label: 'Group External ID',
      required: false,
      maxLength: 255,
      description: 'The group\'s externalId as the identity provider sends it. Set this or the display name, not both.',
      group: 'Group',
    }),

    group_display_name: Field.text({
      label: 'Group Display Name',
      required: false,
      maxLength: 255,
      description: 'The group\'s displayName, matched exactly. Used when the mapping names no external ID.',
      group: 'Group',
    }),

    permission_set: Field.text({
      label: 'Permission Set',
      required: true,
      maxLength: 100,
      description: 'The permission set a member of the group is granted. Administrator sets are refused.',
      group: 'Grant',
    }),

    organization_id: Field.text({
      label: 'Organization',
      required: false,
      maxLength: 255,
      description: 'The organization the grant is made in: the organization that owns the SCIM connection or the SSO provider.',
      group: 'Grant',
    }),

    match_status: Field.select({
      label: 'Match Status',
      required: false,
      readonly: true,
      description: 'Whether the group the mapping names is one its SCIM connection currently pushes. Unmatched grants nothing. Not applicable for an SSO provider, which stores no group list.',
      group: 'Match',
      options: [
        { value: 'matched', label: 'Matched' },
        { value: 'unmatched', label: 'Matches No Current Group' },
        { value: 'not_applicable', label: 'Not Applicable' },
      ],
    }),

    matched_group_id: Field.text({
      label: 'Matched Group ID',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'The ID of the SCIM group the mapping currently matches. Empty when it matches none.',
      group: 'Match',
    }),

    match_changed_at: Field.datetime({
      label: 'Match Changed At',
      required: false,
      readonly: true,
      description: 'When the match status or the matched group last changed.',
      group: 'Match',
    }),

    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
  },

  indexes: [
    { fields: ['source_kind', 'source_id'] },
    { fields: ['organization_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Written only through plugin-auth's platform-admin door, which judges the
    // permission set against the organization boundary before any row lands.
    apiMethods: ['list'],
  },
});
