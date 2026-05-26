// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_account — System Account Object
 *
 * OAuth / credential provider account record.
 * Backed by better-auth's `account` model with ObjectStack field conventions.
 *
 * @namespace sys
 */
export const SysAccount = ObjectSchema.create({
  name: 'sys_account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'link',
  isSystem: true,
  managedBy: 'better-auth',
  description: 'OAuth and authentication provider accounts',
  titleFormat: '{provider_id} - {account_id}',
  compactLayout: ['provider_id', 'user_id', 'account_id'],

  // Custom actions — sysadmins routinely need to revoke a user's OAuth
  // link (e.g. when an SSO provider is decommissioned or the user
  // requests it). Better-auth exposes `/unlink-account { providerId,
  // accountId }` for this. The form is locked to the row's values so
  // it acts as a one-click confirmation rather than a free-form edit.
  actions: [
    {
      name: 'unlink_account',
      label: 'Unlink Account',
      icon: 'unlink',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/unlink-account',
      confirmText: 'Unlink this identity link? The user will no longer be able to sign in with this provider until they re-link it from their account settings.',
      successMessage: 'Identity link removed',
      refreshAfter: true,
      params: [
        { name: 'providerId', field: 'provider_id', defaultFromRow: true, required: true },
        { name: 'accountId', field: 'account_id', defaultFromRow: true, required: true },
      ],
    },
  ],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Links',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'account_id', 'created_at', 'updated_at'],
      filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'provider_id', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    by_provider: {
      type: 'grid',
      name: 'by_provider',
      label: 'By Provider',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'user_id', 'account_id', 'created_at'],
      sort: [{ field: 'provider_id', order: 'asc' }, { field: 'created_at', order: 'desc' }],
      grouping: { fields: [{ field: 'provider_id', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_links: {
      type: 'grid',
      name: 'all_links',
      label: 'All',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'user_id', 'account_id', 'created_at', 'updated_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },
  
  fields: {
    id: Field.text({
      label: 'Account ID',
      required: true,
      readonly: true,
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
    
    provider_id: Field.text({
      label: 'Provider ID',
      required: true,
      description: 'OAuth provider identifier (google, github, etc.)',
    }),
    
    account_id: Field.text({
      label: 'Provider Account ID',
      required: true,
      description: "User's ID in the provider's system",
    }),
    
    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'Link to user table',
    }),
    
    access_token: Field.textarea({
      label: 'Access Token',
      required: false,
    }),
    
    refresh_token: Field.textarea({
      label: 'Refresh Token',
      required: false,
    }),
    
    id_token: Field.textarea({
      label: 'ID Token',
      required: false,
    }),
    
    access_token_expires_at: Field.datetime({
      label: 'Access Token Expires At',
      required: false,
    }),
    
    refresh_token_expires_at: Field.datetime({
      label: 'Refresh Token Expires At',
      required: false,
    }),
    
    scope: Field.text({
      label: 'OAuth Scope',
      required: false,
    }),
    
    password: Field.text({
      label: 'Password Hash',
      required: false,
      description: 'Hashed password for email/password provider',
    }),
  },
  
  indexes: [
    { fields: ['user_id'], unique: false },
    { fields: ['provider_id', 'account_id'], unique: true },
  ],
  
  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: false,
  },
});
