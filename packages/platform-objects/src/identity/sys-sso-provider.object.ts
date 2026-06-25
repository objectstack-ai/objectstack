// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_sso_provider — Registered external SSO identity provider (OIDC / SAML)
 *
 * Backed by `@better-auth/sso`'s `ssoProvider` model. Each row is an external
 * IdP that THIS environment federates LOGIN to (the relying-party / client
 * side) — e.g. the customer's Okta / Entra / Google Workspace. This is the
 * per-environment SSO **mechanism** (ADR-0024): OPEN, configured in the env,
 * and cloud-free for self-host.
 *
 * better-auth stores the protocol detail as a JSON blob in `oidc_config`
 * (OIDC: clientId, clientSecret, endpoints, scopes, mapping, pkce, …) or
 * `saml_config` (SAML: entryPoint, cert, identifierFormat, mapping, …) — not
 * as separate columns. Field set mirrors `@better-auth/sso@1.6.20`'s
 * `BaseSSOProvider`: issuer, oidcConfig, samlConfig, userId, providerId,
 * organizationId, domain.
 *
 * All mutations route through better-auth's `/api/v1/auth/sso/*` endpoints
 * (register / delete-provider) so config validation and secret handling run;
 * the generic data layer is read-only (see `enable.apiMethods`).
 *
 * @namespace sys
 */
export const SysSsoProvider = ObjectSchema.create({
  name: 'sys_sso_provider',
  label: 'SSO Provider',
  pluralLabel: 'SSO Providers',
  icon: 'shield-check',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/sso) — see ADR-0024.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'External SSO identity providers (OIDC / SAML) this environment federates login to',
  displayNameField: 'provider_id',
  titleFormat: '{provider_id}',
  compactLayout: ['provider_id', 'issuer', 'domain'],

  // All mutations go through @better-auth/sso's endpoints under
  // /api/v1/auth/sso/* (register / delete-provider) rather than the generic
  // data layer, so server-side config validation + secret handling run.
  actions: [
    {
      name: 'register_sso_provider',
      label: 'Register SSO Provider',
      icon: 'plus-circle',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/sso/register',
      refreshAfter: true,
      params: [
        { name: 'providerId', label: 'Provider ID', type: 'text', required: true, helpText: 'Stable identifier, e.g. "okta" or "acme-entra".' },
        { name: 'issuer', label: 'Issuer URL', type: 'text', required: true, helpText: 'IdP issuer / discovery base, e.g. https://acme.okta.com.' },
        { name: 'domain', label: 'Email Domain', type: 'text', required: true, helpText: 'Users with this email domain are routed to this IdP.' },
        { name: 'clientId', label: 'Client ID', type: 'text', required: true },
        { name: 'clientSecret', label: 'Client Secret', type: 'text', required: true },
      ],
    },
    {
      name: 'delete_sso_provider',
      label: 'Delete SSO Provider',
      icon: 'trash-2',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/sso/delete-provider',
      confirmText: 'Delete this SSO provider? Users from its domain will no longer be able to sign in through it.',
      successMessage: 'SSO provider deleted',
      refreshAfter: true,
      params: [
        { name: 'providerId', field: 'provider_id', defaultFromRow: true, required: true },
      ],
    },
  ],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_sso_provider' },
      columns: ['provider_id', 'issuer', 'domain', 'created_at'],
      sort: [{ field: 'provider_id', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    provider_id: Field.text({
      label: 'Provider ID',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Stable provider identifier (unique within the environment)',
      group: 'Identity',
    }),

    issuer: Field.text({
      label: 'Issuer',
      required: true,
      maxLength: 2048,
      description: 'IdP issuer URL',
      group: 'Identity',
    }),

    domain: Field.text({
      label: 'Email Domain',
      required: true,
      maxLength: 255,
      description: 'Email domain routed to this IdP (e.g. acme.com)',
      group: 'Identity',
    }),

    oidc_config: Field.textarea({
      label: 'OIDC Config',
      required: false,
      description: 'JSON: clientId, clientSecret, endpoints, scopes, mapping, pkce (managed by better-auth)',
      group: 'Protocol',
    }),

    saml_config: Field.textarea({
      label: 'SAML Config',
      required: false,
      description: 'JSON: entryPoint, cert, identifierFormat, mapping (managed by better-auth)',
      group: 'Protocol',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Registered By',
      required: false,
      description: 'User who registered this provider',
      group: 'System',
    }),

    organization_id: Field.text({
      label: 'Organization',
      required: false,
      maxLength: 255,
      description: 'Organization scope (when org-scoped SSO is used)',
      group: 'System',
    }),

    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
  },

  indexes: [
    { fields: ['provider_id'], unique: true },
    { fields: ['domain'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // Mutations go through /api/v1/auth/sso/* (register / delete-provider);
    // the generic data layer is read-only so sysadmins cannot bypass
    // server-side validation / secret handling.
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
  },
});
