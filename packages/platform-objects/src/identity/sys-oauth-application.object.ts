// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_application — Registered OAuth/OIDC client application
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthClient` model. Each row
 * represents an external application that has been registered to authenticate
 * users against this ObjectStack server (acting as an OpenID Connect IdP).
 *
 * The table name is preserved from the deprecated `oidc-provider` plugin
 * (which used the `oauthApplication` model name) so existing data remains
 * accessible. The new model exposes a richer set of OAuth 2.1 / OIDC
 * registration fields — see RFC 7591 (Dynamic Client Registration) and
 * RFC 8414 (Authorization Server Metadata).
 *
 * @namespace sys
 */
export const SysOauthApplication = ObjectSchema.create({
  name: 'sys_oauth_application',
  label: 'OAuth Application',
  pluralLabel: 'OAuth Applications',
  icon: 'key-round',
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
  description: 'Registered OAuth/OIDC client applications',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'client_id', 'type', 'disabled'],

  // Custom actions — all OAuth-application mutations are routed through
  // better-auth's `@better-auth/oauth-provider` endpoints (and a thin
  // ObjectStack-added auth route for the enable/disable toggle) rather
  // than the generic data layer, so server-side validation, secret
  // hashing, and audit hooks all run. The generic `delete` API method
  // is intentionally dropped from `apiMethods` below so the only delete
  // path is the better-auth wrapper.
  //
  // Upstream gap (better-auth 1.6.11): the stock `/admin/oauth2/update-client`
  // endpoint's Zod body schema does NOT accept the `disabled` flag, even
  // though the column exists and the runtime honours it. We bridge the
  // gap with `POST /api/v1/auth/admin/oauth2/toggle-disabled`, registered
  // by plugin-auth, which writes through better-auth's own adapter under
  // the auth namespace (no generic data-layer bypass). When upstream
  // ships `disabled` support, retarget the enable/disable actions and
  // delete the bridge route.
  actions: [
    {
      name: 'disable_oauth_application',
      label: 'Disable OAuth Application',
      icon: 'pause-circle',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/oauth2/toggle-disabled',
      requiresFeature: 'oidcProvider',
      confirmText: 'Disable this OAuth application? Active access/refresh tokens issued to it will continue to be rejected at the token, authorize, and introspect endpoints. Existing integrations will stop working immediately.',
      successMessage: 'OAuth application disabled',
      refreshAfter: true,
      visible: '!record.disabled',
      bodyExtra: { disabled: true },
      params: [
        { name: 'client_id', field: 'client_id', defaultFromRow: true, required: true },
      ],
    },
    {
      name: 'enable_oauth_application',
      label: 'Enable OAuth Application',
      icon: 'play-circle',
      variant: 'primary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/admin/oauth2/toggle-disabled',
      requiresFeature: 'oidcProvider',
      confirmText: 'Re-enable this OAuth application? Token issuance, authorization, and introspection will resume immediately.',
      successMessage: 'OAuth application enabled',
      refreshAfter: true,
      visible: 'record.disabled',
      bodyExtra: { disabled: false },
      params: [
        { name: 'client_id', field: 'client_id', defaultFromRow: true, required: true },
      ],
    },
    {
      name: 'create_oauth_application',
      label: 'Register OAuth Application',
      icon: 'plus-circle',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/sys-oauth-application/register',
      requiresFeature: 'oidcProvider',
      refreshAfter: true,
      params: [
        { name: 'name', label: 'Application Name', type: 'text', required: true },
        { name: 'redirectURLs', label: 'Redirect URLs', type: 'textarea', required: true, helpText: 'One URL per line. Must use https:// in production.' },
        { name: 'type', label: 'Application Type', type: 'select', required: true, defaultValue: 'web', options: [
          { label: 'Web', value: 'web' },
          { label: 'Native', value: 'native' },
          { label: 'User-agent based', value: 'user-agent-based' },
          { label: 'Public', value: 'public' },
        ] },
      ],
      resultDialog: {
        title: 'OAuth application registered',
        description: 'Save the client_secret now — it is shown only once and cannot be recovered. You can rotate it later if it leaks.',
        acknowledge: 'I have saved the client secret',
        fields: [
          { path: 'client.client_id', label: 'Client ID', format: 'text' },
          { path: 'client.client_secret', label: 'Client Secret', format: 'secret' },
        ],
      },
    },
    {
      name: 'rotate_client_secret',
      label: 'Rotate Client Secret',
      icon: 'refresh-cw',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/oauth2/client/rotate-secret',
      requiresFeature: 'oidcProvider',
      confirmText: 'Rotate this OAuth client\'s secret? The previous secret will stop working immediately and any integrations using it will break until they are updated with the new secret. The new secret is shown only once.',
      refreshAfter: true,
      params: [
        { name: 'client_id', field: 'client_id', defaultFromRow: true, required: true },
      ],
      resultDialog: {
        title: 'Client secret rotated',
        description: 'Save the new secret now — it is shown only once. Update every integration before the previous secret\'s grace period ends.',
        acknowledge: 'I have updated my integrations',
        fields: [
          { path: 'client_secret', label: 'New Client Secret', format: 'secret' },
        ],
      },
    },
    {
      name: 'delete_oauth_application',
      label: 'Delete OAuth Application',
      icon: 'trash-2',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/auth/oauth2/delete-client',
      requiresFeature: 'oidcProvider',
      confirmText: 'Permanently delete this OAuth application? All issued tokens and consents will be invalidated and integrations using this client_id will stop working immediately. This cannot be undone.',
      successMessage: 'OAuth application deleted',
      refreshAfter: true,
      params: [
        { name: 'client_id', field: 'client_id', defaultFromRow: true, required: true },
      ],
    },
  ],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Applications',
      data: { provider: 'object', object: 'sys_oauth_application' },
      columns: ['name', 'client_id', 'type', 'disabled', 'created_at'],
      // Self-service Account view — scope to the signed-in user's own
      // registrations so they don't see other developers' apps. Admins
      // get the unfiltered `active` / `disabled_apps` / `all_apps` views
      // via the Setup → OAuth Applications nav.
      filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_oauth_application' },
      columns: ['name', 'client_id', 'type', 'updated_at'],
      filter: [{ field: 'disabled', operator: 'equals', value: false }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    disabled_apps: {
      type: 'grid',
      name: 'disabled_apps',
      label: 'Disabled',
      data: { provider: 'object', object: 'sys_oauth_application' },
      columns: ['name', 'client_id', 'type', 'updated_at'],
      filter: [{ field: 'disabled', operator: 'equals', value: true }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_apps: {
      type: 'grid',
      name: 'all_apps',
      label: 'All',
      data: { provider: 'object', object: 'sys_oauth_application' },
      columns: ['name', 'client_id', 'type', 'disabled', 'created_at'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    name: Field.text({
      label: 'Name',
      required: false,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    icon: Field.url({
      label: 'Icon',
      required: false,
      description: 'Logo URL shown on the consent screen',
      group: 'Identity',
    }),

    uri: Field.url({
      label: 'Home URI',
      required: false,
      description: 'Public homepage of the registered client',
      group: 'Identity',
    }),

    contacts: Field.textarea({
      label: 'Contacts',
      required: false,
      description: 'JSON-serialized list of contact email addresses',
      group: 'Identity',
    }),

    tos: Field.url({
      label: 'Terms of Service',
      required: false,
      group: 'Identity',
    }),

    policy: Field.url({
      label: 'Privacy Policy',
      required: false,
      group: 'Identity',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON-serialized application metadata',
      group: 'Identity',
    }),

    // ── OAuth Credentials ────────────────────────────────────────
    client_id: Field.text({
      label: 'Client ID',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'Public OAuth client identifier',
      group: 'Credentials',
    }),

    client_secret: Field.text({
      label: 'Client Secret',
      required: false,
      maxLength: 1024,
      description: 'OAuth client secret (hashed/encrypted at rest)',
      group: 'Credentials',
    }),

    redirect_uris: Field.textarea({
      label: 'Redirect URIs',
      required: true,
      description: 'JSON-serialized list of allowed redirect URIs',
      group: 'Credentials',
    }),

    post_logout_redirect_uris: Field.textarea({
      label: 'Post-logout Redirect URIs',
      required: false,
      description: 'JSON-serialized list of allowed post-logout redirect URIs',
      group: 'Credentials',
    }),

    type: Field.select(['web', 'native', 'user-agent-based', 'public'], {
      label: 'Client Type',
      required: false,
      defaultValue: 'web',
      group: 'Credentials',
    }),

    public: Field.boolean({
      label: 'Public Client',
      required: false,
      description: 'Marks the client as a public (non-confidential) OAuth client',
      group: 'Credentials',
    }),

    require_pkce: Field.boolean({
      label: 'Require PKCE',
      required: false,
      group: 'Credentials',
    }),

    token_endpoint_auth_method: Field.text({
      label: 'Token Endpoint Auth Method',
      required: false,
      maxLength: 64,
      description: 'e.g. client_secret_basic, client_secret_post, none',
      group: 'Credentials',
    }),

    grant_types: Field.textarea({
      label: 'Grant Types',
      required: false,
      description: 'JSON-serialized list of allowed grant types',
      group: 'Credentials',
    }),

    response_types: Field.textarea({
      label: 'Response Types',
      required: false,
      description: 'JSON-serialized list of allowed response types',
      group: 'Credentials',
    }),

    scopes: Field.textarea({
      label: 'Allowed Scopes',
      required: false,
      description: 'JSON-serialized list of scopes the client may request',
      group: 'Credentials',
    }),

    subject_type: Field.text({
      label: 'Subject Type',
      required: false,
      maxLength: 32,
      description: 'OIDC subject type (e.g. public, pairwise)',
      group: 'Credentials',
    }),

    jwks: Field.textarea({
      label: 'JWKS',
      required: false,
      description: 'Client JSON Web Key Set (for private_key_jwt / signed-request verification)',
      group: 'Credentials',
    }),

    jwks_uri: Field.url({
      label: 'JWKS URI',
      required: false,
      description: 'URL of the client JSON Web Key Set',
      group: 'Credentials',
    }),

    dpop_bound_access_tokens: Field.boolean({
      label: 'DPoP-bound Access Tokens',
      required: false,
      defaultValue: false,
      description: 'Require access tokens issued to this client to be DPoP-bound (RFC 9449)',
      group: 'Credentials',
    }),

    // ── Behaviour flags ──────────────────────────────────────────
    disabled: Field.boolean({
      label: 'Disabled',
      required: false,
      defaultValue: false,
      group: 'Behaviour',
    }),

    skip_consent: Field.boolean({
      label: 'Skip Consent',
      required: false,
      description: 'Treat as a trusted client and bypass the consent screen',
      group: 'Behaviour',
    }),

    enable_end_session: Field.boolean({
      label: 'Enable End Session',
      required: false,
      description: 'Allow the client to call the OIDC end-session endpoint',
      group: 'Behaviour',
    }),

    backchannel_logout_uri: Field.url({
      label: 'Back-channel Logout URI',
      required: false,
      description: 'OIDC back-channel logout endpoint of the client',
      group: 'Behaviour',
    }),

    backchannel_logout_session_required: Field.boolean({
      label: 'Back-channel Logout Session Required',
      required: false,
      description: 'Whether the back-channel logout token must include a sid claim',
      group: 'Behaviour',
    }),

    // ── Software statement (RFC 7591 §2.3) ───────────────────────
    software_id: Field.text({
      label: 'Software ID',
      required: false,
      maxLength: 255,
      group: 'Software',
    }),

    software_version: Field.text({
      label: 'Software Version',
      required: false,
      maxLength: 64,
      group: 'Software',
    }),

    software_statement: Field.textarea({
      label: 'Software Statement',
      required: false,
      description: 'Signed JWT asserting the client metadata (RFC 7591 §2.3)',
      group: 'Software',
    }),

    // ── Ownership / system ───────────────────────────────────────
    user_id: Field.lookup('sys_user', {
      label: 'Owner User',
      required: false,
      description: 'User who registered this application',
      group: 'System',
    }),

    reference_id: Field.text({
      label: 'Reference ID',
      required: false,
      maxLength: 255,
      description: 'Caller-supplied correlation identifier',
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['client_id'], unique: true },
    { fields: ['user_id'] },
    { fields: ['reference_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // All mutations (create/update/delete) must go through better-auth's
    // oauth-provider endpoints under /api/v1/auth/{admin/,}oauth2/* — the
    // generic data layer is read-only for this object so sysadmins cannot
    // bypass server-side OAuth validation. The Delete row action above is
    // wired to /api/v1/auth/oauth2/delete-client.
    apiMethods: ['get', 'list'],
    trash: false,
    mru: false,
  },
});
