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
  // ADR-0024 — env-global, ADMIN-ONLY identity config. Two orthogonal controls:
  //   • `tenancy.enabled: false` — the env IS the tenant; providers are env-wide,
  //     not org-partitioned. Opting out of multi-tenancy lets a platform admin's
  //     `viewAllRecords` superuser bypass see every provider (without it, the
  //     `member_default` wildcard `tenant_isolation` RLS denies every row, since
  //     better-auth writes via its adapter with no tenantId → `organization_id`
  //     is never stamped).
  //   • `requiredPermissions: ['manage_platform_settings']` — object-level
  //     capability gate (ADR-0066 D3) so ordinary members are denied entirely
  //     (without it, tenancy-disabled + `member_default`'s `'*': allowRead` would
  //     leak providers to every authenticated user).
  // Together: admins see all env providers; non-admins get 403. better-auth's
  // own endpoints already read via a system context. (Env-only object — no
  // control-plane cross-tenant risk.)
  tenancy: { enabled: false },
  requiredPermissions: ['manage_platform_settings'],
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth (@better-auth/sso) — see ADR-0024.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'External SSO identity providers (OIDC / SAML) this environment federates login to',
  displayNameField: 'provider_id',
  nameField: 'provider_id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{provider_id}',
  highlightFields: ['provider_id', 'issuer', 'domain'],

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
      // Routed through the env-side bridge (plugin-auth `auth-plugin.ts`), which
      // reshapes these FLAT form fields into the nested `oidcConfig` body that
      // `@better-auth/sso`'s /sso/register requires, then re-dispatches to it
      // (so the admin gate + discovery hydration run). Posting straight to
      // /sso/register would drop clientId/clientSecret (top-level → Zod-stripped)
      // and persist an unusable `oidc_config = null` provider.
      target: '/api/v1/auth/admin/sso/register',
      refreshAfter: true,
      params: [
        { name: 'providerId', label: 'Provider ID', type: 'text', required: true, helpText: 'Stable identifier, e.g. "okta" or "acme-entra".' },
        { name: 'issuer', label: 'Issuer URL', type: 'text', required: true, helpText: 'IdP issuer, e.g. https://acme.okta.com. Discovery is fetched from here unless an explicit URL is given below.' },
        { name: 'domain', label: 'Email Domain', type: 'text', required: true, helpText: 'Users with this email domain are routed to this IdP, e.g. acme.com.' },
        { name: 'clientId', label: 'Client ID', type: 'text', required: true, helpText: 'OAuth client ID issued by the IdP for this environment.' },
        { name: 'clientSecret', label: 'Client Secret', type: 'text', required: true, helpText: 'OAuth client secret (stored encrypted by better-auth).' },
        { name: 'discoveryEndpoint', label: 'Discovery URL', type: 'text', required: false, helpText: 'Optional. OIDC discovery document URL. Leave blank to derive `<issuer>/.well-known/openid-configuration`.' },
        { name: 'scopes', label: 'Scopes', type: 'text', required: false, placeholder: 'openid email profile', helpText: 'Optional. Space- or comma-separated OAuth scopes. Defaults to "openid email profile".' },
        { name: 'mapId', label: 'Map: User ID claim', type: 'text', required: false, placeholder: 'sub', helpText: 'Optional. ID-token claim mapped to the user ID. Defaults to "sub".' },
        { name: 'mapEmail', label: 'Map: Email claim', type: 'text', required: false, placeholder: 'email', helpText: 'Optional. Claim mapped to email. Defaults to "email".' },
        { name: 'mapName', label: 'Map: Name claim', type: 'text', required: false, placeholder: 'name', helpText: 'Optional. Claim mapped to display name. Defaults to "name".' },
      ],
    },
    {
      name: 'register_saml_provider',
      label: 'Register SAML Provider',
      icon: 'shield',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      // SAML 2.0 via @better-auth/sso (samlify-backed). Routed through the
      // env-side bridge (plugin-auth `auth-plugin.ts` → register-saml), which
      // reshapes these FLAT IdP fields into the nested `samlConfig` body that
      // @better-auth/sso's /sso/register requires (entryPoint/cert/callbackUrl/
      // spMetadata/identifierFormat), derives the per-provider ACS URL, and
      // re-dispatches to /sso/register (admin gate runs). The response returns
      // the SP ACS + metadata URLs to configure on the IdP.
      target: '/api/v1/auth/admin/sso/register-saml',
      refreshAfter: true,
      params: [
        { name: 'providerId', label: 'Provider ID', type: 'text', required: true, helpText: 'Stable identifier, e.g. "acme-saml".' },
        { name: 'issuer', label: 'IdP Entity ID', type: 'text', required: true, helpText: 'The IdP’s SAML EntityID (issuer), e.g. https://saml.acme.com/entityid.' },
        { name: 'domain', label: 'Email Domain', type: 'text', required: true, helpText: 'Users with this email domain are routed to this IdP, e.g. acme.com.' },
        { name: 'entryPoint', label: 'IdP SSO URL', type: 'text', required: true, helpText: 'The IdP’s SAML single sign-on (redirect) endpoint that receives the SAMLRequest.' },
        { name: 'cert', label: 'IdP Signing Certificate', type: 'textarea', required: true, helpText: 'The IdP’s X.509 signing certificate (PEM body). Used to verify assertion signatures.' },
        { name: 'identifierFormat', label: 'NameID Format', type: 'text', required: false, placeholder: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', helpText: 'Optional. Requested SAML NameID format. Defaults to the IdP’s configured format.' },
      ],
    },
    {
      name: 'request_domain_verification',
      label: 'Request Domain Verification',
      icon: 'globe',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      // ADR-0024 ② (opt-in OS_SSO_DOMAIN_VERIFICATION). Asks @better-auth/sso
      // for a one-time DNS-TXT challenge and reveals the ready-to-paste record
      // ONCE via `resultDialog`. Routed through the env bridge (plugin-auth /
      // cloud AuthProxyPlugin) which reshapes the `{domainVerificationToken}`
      // response into a `{ success, data: { dnsRecordName, dnsRecordValue } }`
      // envelope. The console action runtime unwraps that envelope, so the
      // `resultDialog` field paths are relative to the inner `data` payload
      // (`dnsRecordName`, not `data.dnsRecordName`) — consistent with every
      // other object's resultDialog (create_user, two-factor, OAuth). When the
      // feature is OFF the bridge returns a clear "not enabled for this
      // environment" error instead of a bare 404.
      target: '/api/v1/auth/admin/sso/request-domain-verification',
      params: [
        { name: 'providerId', field: 'provider_id', defaultFromRow: true, required: true },
        { name: 'domain', field: 'domain', defaultFromRow: true, required: false },
      ],
      resultDialog: {
        title: 'Verify your domain',
        description:
          'Add the DNS TXT record below at your domain’s DNS provider, then run “Verify Domain”. The token is shown once.',
        acknowledge: 'Done',
        fields: [
          { path: 'dnsRecordType', label: 'Record type', format: 'text' },
          { path: 'dnsRecordName', label: 'Name / Host', format: 'secret' },
          { path: 'dnsRecordValue', label: 'Value', format: 'secret' },
        ],
      },
    },
    {
      name: 'verify_domain',
      label: 'Verify Domain',
      icon: 'shield-check',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      // ADR-0024 ②. Re-checks the DNS-TXT record and flips `domain_verified`
      // on success. Routed through the env bridge, which maps @better-auth/sso's
      // empty 204 / 502 into a clear success/error toast.
      target: '/api/v1/auth/admin/sso/verify-domain',
      successMessage: 'Domain ownership verified',
      refreshAfter: true,
      params: [
        { name: 'providerId', field: 'provider_id', defaultFromRow: true, required: true },
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
      columns: ['provider_id', 'issuer', 'domain', 'domain_verified', 'created_at'],
      sort: [{ field: 'provider_id', order: 'asc' }],
      pagination: { pageSize: 50 },
      // Per-object empty state — the shared identity-object copy ("created
      // automatically … cannot be added here") is wrong for this object, which
      // HAS a "Register SSO Provider" action. Point admins at it instead.
      emptyState: {
        title: 'No SSO providers yet',
        message: 'Register your organization’s external IdP — OIDC (Okta, Entra, Auth0, …) with “Register SSO Provider”, or SAML 2.0 with “Register SAML Provider”. Members whose email domain matches can then sign in through it.',
        icon: 'log-in',
      },
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

    domain_verified: Field.boolean({
      label: 'Domain Verified',
      defaultValue: false,
      readonly: true,
      description:
        'Whether DNS ownership of the email domain has been proven (ADR-0024 ②). Set by “Verify Domain” after the DNS TXT record resolves. Managed by better-auth — not directly editable. Only enforced when domain verification is enabled for the environment.',
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
  },
});
