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
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'OAuth and authentication provider accounts',
  titleFormat: '{provider_id} - {account_id}',
  highlightFields: ['provider_id', 'user_id', 'account_id'],

  // Custom actions — sysadmins routinely need to revoke a user's OAuth
  // link (e.g. when an SSO provider is decommissioned or the user
  // requests it). Better-auth exposes `/unlink-account { accountId }` for
  // this, where `accountId` is the account ROW id (better-auth 1.7 narrowed
  // the body from the old `{ providerId, accountId }` pair, and `accountId`
  // no longer means the provider's id for the user — that field is now
  // `accountId`). The form is locked to the row's values so it acts
  // as a one-click confirmation rather than a free-form edit.
  //
  // `link_social` is the self-service counterpart — a toolbar action
  // that redirects the browser to better-auth's social sign-in endpoint
  // with a callbackURL pointing back to the linked-accounts view. The
  // endpoint sets the link cookie and OAuth-dances through the provider,
  // which is why it's `type: 'url'` (full page navigation) rather than
  // `type: 'api'` (XHR — would block on CORS / 302).
  actions: [
    {
      name: 'link_social',
      label: 'Link Social Account',
      icon: 'link-2',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'url',
      target: '/api/v1/auth/sign-in/social?provider=${param.provider}&callbackURL=${ctx.origin}/_console/apps/account/sys_account',
      params: [
        {
          name: 'provider',
          label: 'Provider',
          type: 'select',
          required: true,
          options: [
            { label: 'Google', value: 'google' },
            { label: 'GitHub', value: 'github' },
            { label: 'Microsoft', value: 'microsoft' },
            { label: 'Apple', value: 'apple' },
            { label: 'Facebook', value: 'facebook' },
            { label: 'GitLab', value: 'gitlab' },
            { label: 'Discord', value: 'discord' },
          ],
        },
      ],
    },
    {
      name: 'unlink_account',
      label: 'Unlink Account',
      icon: 'unlink',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/unlink-account',
      // Confirm question on `description`, not `confirmText`: this action collects
      // params, and pairing the two keys opens two dialogs for one decision
      // (#7278 ruling 2026-08-10, swept by #7309).
      description: 'Unlink this identity link? The user will no longer be able to sign in with this provider until they re-link it from their account settings.',
      successMessage: 'Identity link removed',
      refreshAfter: true,
      params: [
        { name: 'accountId', field: 'id', defaultFromRow: true, required: true },
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

    // better-auth 1.7 keys account identity on (issuer, account_id) rather than
    // on the provider id alone: the issuer names the authority that vouched for
    // that id — an OIDC `iss` claim for federated logins, or a synthetic
    // `local:credential` / `local:oauth:<provider>` for providers that have
    // none. better-auth writes it on every new account; rows created before the
    // 1.7 upgrade are stamped at boot by the auth plugin's issuer backfill.
    //
    // Deliberately NOT `required` even though better-auth always supplies it: a
    // NOT NULL column cannot be added to a table that already holds rows, and
    // schema sync runs before the backfill.
    issuer: Field.text({
      label: 'Issuer',
      required: false,
      description: 'Authority that vouched for the provider account id — an OIDC issuer, or local:… for providers without one',
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
    
    // ── Live third-party credentials (never on the generic data path) ──────
    //
    // [#7987] These three columns hold the user's LIVE bearer credentials for
    // SOMEONE ELSE'S service — the tokens ObjectStack received from Google,
    // GitHub, an OIDC IdP — in cleartext. better-auth writes them plain here:
    // its `account.encryptOAuthTokens` option is not set (see
    // `AUTH_ACCOUNT_CONFIG` in plugin-auth's `auth-schema-config.ts`), so
    // `setTokenUtil` stores the value verbatim.
    //
    // Before `internal: true` they serialized on the generic data path, on an
    // object that declares `apiEnabled: true, apiMethods: ['get','list']`:
    //
    //  - an ADMIN read every user's tokens (list, get-by-id, `?select=`);
    //  - a MEMBER read their own, because the `sys_account_self` RLS policy
    //    (`plugin-security/objects/default-permission-sets.ts`) grants
    //    `select` on `user_id == current_user.id`. That arm is the one this
    //    object does NOT share with `sys_session`: it converts a short-lived,
    //    revocable ObjectStack session bearer into the user's long-lived
    //    third-party REFRESH token, which survives revocation here entirely.
    //
    // Neither collector reached them: `maskSecretFields` collects by field
    // TYPE (`textarea` is not `secret`/`password`) *and* exempts objects with
    // `managedBy: 'better-auth'` — which this object is — so the one mask that
    // could have applied was exempt by construction (#7902's survey result).
    //
    // `internal: true` is the same flag #7728 minted for `sys_api_key.key` and
    // #7823 applied to `sys_session.token`: the engine OMITS the key from
    // find/findOne results, on the default projection and when a client names
    // the column in `?select=`. Storage, filtering and indexing are untouched.
    //
    // ⛔ NOT retyped to `Field.secret()`, deliberately. better-auth owns every
    // write to this object through its own adapter; routing them through the
    // engine's encrypt-on-write path would sit between better-auth and its
    // adapter. `Field.password()` is inert for the two reasons above (type-keyed
    // collection + the `better-auth` exemption).
    //
    // ⚠️ better-auth READS these back off adapter result rows — measured, and
    // the load-bearing risk this card was parked on:
    // `internalAdapter.findAccounts(userId)` (no projection) feeds
    // `resolveUserAccount`, and `/get-access-token`, `/account-info` and
    // `/refresh-token` then read `account.refreshToken` / `.accessToken` /
    // `.idToken` off those rows. The read strip alone would make the refresh
    // exchange answer `REFRESH_TOKEN_NOT_FOUND` and hand back an empty access
    // token. They are re-attached at better-auth's own storage seam through
    // the privileged accessor — `internal-field-readback.ts` in plugin-auth,
    // over `Engine.resolveInternalField` (#8118) — exactly as #7823 did for
    // `sys_session.token`. ⛔ Do not add an engine-side carve-out.
    access_token: Field.textarea({
      label: 'Access Token',
      required: false,
      internal: true,
      description: "Live OAuth access token issued by the provider — never returned on the data API (#7987); better-auth reads it back through the engine's privileged internal-field accessor",
    }),

    refresh_token: Field.textarea({
      label: 'Refresh Token',
      required: false,
      internal: true,
      description: 'Live OAuth refresh token — long-lived and not revoked by revoking an ObjectStack session; never returned on the data API (#7987)',
    }),

    id_token: Field.textarea({
      label: 'ID Token',
      required: false,
      internal: true,
      description: 'OIDC ID token issued by the provider — never returned on the data API (#7987)',
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
    
    // [#8676] `internal: true` — never returned on the generic data path.
    // Both columns below are one-way password hashes (ADR-0100's third
    // channel), and BOTH serialized on `/api/v1/data/sys_account` before this
    // flag: to an admin for every user's row, and to a member for their own
    // (the `sys_account_self` RLS policy grants `select` on `user_id ==
    // current_user.id`). Neither credential collector catches them —
    // `collectMaskedReadFields` keys on the field TYPE (`secret` / `password`)
    // and additionally exempts `managedBy: 'better-auth'` objects, which this
    // one is, while these are `text` / `textarea` columns. The flag is the
    // third channel's answer, and it is the same disposition #7728 reached for
    // `sys_api_key.key` — also a stored hash, also ruled unfit to serialize
    // through the API face. Serving a password hash hands out an offline
    // cracking target; the history ring multiplies it.
    //
    // ⚠️ Flagging a column STARVES every reader that takes it off a result
    // row — with no `isSystem` carve-out, by #7728's design. Both columns have
    // such readers, and each is recovered through the engine's privileged
    // accessor (`Engine.resolveInternalField`, #8118) rather than by punching a
    // hole in the strip: better-auth's adapter reads via the readback seam in
    // `plugin-auth/src/internal-field-readback.ts`, and plugin-auth's own
    // raw-engine readers (the ADR-0069 D1 reuse ring, the dev seed-admin
    // probe) via `recoverInternalFieldsForSystemRead` in that same module.
    password: Field.text({
      label: 'Password Hash',
      required: false,
      internal: true,
      description: 'Hashed password for email/password provider',
    }),

    // ADR-0069 D1 — bounded ring of previous password hashes (JSON array of
    // strings), used to reject password reuse on change/reset. Maintained by
    // the auth manager; never exposed in UI.
    previous_password_hashes: Field.textarea({
      label: 'Previous Password Hashes',
      required: false,
      readonly: true,
      hidden: true,
      internal: true,
      description: 'JSON array of prior password hashes (bounded by password_history_count); reuse-prevention only. System-managed.',
    }),
  },
  
  indexes: [
    { fields: ['user_id'], unique: false },
    { fields: ['provider_id', 'account_id'], unique: true },
    // better-auth 1.7 resolves accounts by (issuer, accountId) and
    // declares that pair unique on its own `account` table — mirror it here so
    // the physical table enforces the same identity key the auth code assumes.
    { fields: ['issuer', 'account_id'], unique: true },
  ],
  
  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // #1591 — reads only: writes are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth. HTTP answers 405 before the 403.
    apiMethods: ['get', 'list'],
  },
});
