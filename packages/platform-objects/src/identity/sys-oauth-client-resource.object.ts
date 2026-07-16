// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_client_resource — Client ↔ protected-resource grant
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthClientResource` model
 * (better-auth ≥ 1.7). Join table allowing a registered client to request
 * tokens for a registered resource (RFC 8707). A missing row means the
 * client is not authorized for that audience.
 *
 * @namespace sys
 */
export const SysOauthClientResource = ObjectSchema.create({
  name: 'sys_oauth_client_resource',
  label: 'OAuth Client Resource',
  pluralLabel: 'OAuth Client Resources',
  icon: 'link',
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
  description: 'Grants allowing an OAuth client to request tokens for a protected resource',
  highlightFields: ['client_id', 'resource_id'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: true,
      description: 'Foreign key to sys_oauth_application.client_id',
    }),

    resource_id: Field.text({
      label: 'Resource ID',
      required: true,
      maxLength: 1024,
      description: 'Foreign key to sys_oauth_resource.identifier',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON object of additional grant metadata',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['client_id'] },
    { fields: ['resource_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
    trash: false,
    mru: false,
  },
});
