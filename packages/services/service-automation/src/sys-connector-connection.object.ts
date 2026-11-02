// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_connector_connection — the connection record of a grant-bearing
 * declarative connector instance (ADR-0143 D3, Q2 = B).
 *
 * An `oauth2` instance with `grant: 'authorization_code'` is authorized once
 * by an administrator (D5). What that grant produces and cannot be obtained
 * again unattended is kept here, and nothing else:
 *
 *   - the refresh token (`refresh_token`, `Field.secret()`), replaced
 *     atomically when the authorization server rotates it (D2.1, D4);
 *   - the grant's status, scopes and expiry, for the Console and for the
 *     `degraded` reason D4 names ("not connected", "reconnect required");
 *   - the client the connection authorizes with when the instance does not
 *     declare one: a client the MCP authorization flow discovered or
 *     registered, or the client the administrator entered on an instance
 *     declaring `clientSource: 'installer'` (D2.1, 2026-11-02 amendment), in
 *     `registered_client` (`Field.secret()`), with the installer's client id
 *     repeated in plain `client_id` so a read can show which client is set
 *     without decrypting anything.
 *
 * ⛔ Not here: the access token. It lives in the automation plugin's
 * in-process cache only (D3, last bullet), as does every `client_credentials`
 * token, which the instance's client secret re-derives at any time — so a
 * `client_credentials` instance has no row. The client secret itself stays a
 * `credentialRef`, resolved through the #27237 chain (D3, first bullet).
 *
 * One row per `(organization, connector instance)` (Q1 = A: a connection is
 * shared by its organization, and every run of that organization dispatches
 * with it). The organization column is explicit so the row is bound to the
 * organization that connected it, not to whatever context reads it.
 *
 * ⛔ Not a sign-in account (D6). Nothing here is a better-auth `account` row,
 * and no sign-in path reads it: an integration grant never lets anyone sign in,
 * and no sign-in revokes or replaces it.
 *
 * Writers and readers: the automation plugin alone (`connector-connections.ts`),
 * under a system context — the connect / callback / revoke door and the
 * per-dispatch refresh. The generic data door is closed, as on
 * `sys_connector_credential`.
 *
 * @namespace sys
 */
export const SysConnectorConnection = ObjectSchema.create({
  name: 'sys_connector_connection',
  label: 'Connector Connection',
  pluralLabel: 'Connector Connections',
  icon: 'plug',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0066 secure-by-default: a token store is not covered by the wildcard
  // grant. Everything reads and writes it through the automation plugin under
  // a system context.
  access: { default: 'private' },
  description:
    "Connection record of a grant-bearing connector instance (ADR-0143 D3): one row per organization and instance, holding the encrypted refresh token and the grant's status, scopes and expiry. Never an access token, never a sign-in account.",
  displayNameField: 'connector_name',
  nameField: 'connector_name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['connector_name', 'status', 'expires_at', 'connected_at'],

  fields: {
    organization_id: Field.text({
      label: 'Organization',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The organization that connected this instance; every run of that organization dispatches with this connection (ADR-0143 Q1).',
    }),

    connector_name: Field.text({
      label: 'Connector Instance',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The declarative connector instance this connection authorizes, exactly as declared.',
    }),

    grant: Field.select(['authorization_code'], {
      label: 'Grant',
      required: true,
      readonly: true,
      description: 'The OAuth2 grant that produced this connection. Only `authorization_code` keeps a row: a `client_credentials` token is re-derived from the client secret.',
    }),

    refresh_token: Field.secret({
      label: 'Refresh Token',
      description:
        'The refresh token the authorization server issued, encrypted at rest and masked on every read; replaced atomically when the server rotates it. Absent when the server issues none.',
    }),

    registered_client: Field.secret({
      label: 'Registered Client',
      description:
        "The OAuth client this connection authorizes with when the instance does not declare one (ADR-0143 D2.1): the client a `provider: 'mcp'` instance's MCP authorization flow discovered or registered (the issuer, the two endpoints, the resource indicator, the client id and any client secret the registration issued), or the client the administrator entered on an instance declaring `clientSource: 'installer'` (its id and secret, and the endpoints when they were discovered). Encrypted at rest and masked on every read; absent when the instance declares its endpoints and client.",
    }),

    client_id: Field.text({
      label: 'Client ID',
      readonly: true,
      maxLength: 512,
      description:
        "The id of the OAuth client the administrator entered on this connection, for an instance declaring `clientSource: 'installer'` (ADR-0143 D2.1). Not a secret: it is what a read shows to say which client is set. The client itself, with its secret, is kept in `registered_client`. Empty for any other instance.",
    }),

    client_has_secret: Field.boolean({
      label: 'Client Secret Set',
      readonly: true,
      defaultValue: false,
      description:
        "Whether the administrator's client (`client_id`) came with a client secret, which is kept encrypted in `registered_client` and never read back here. `false` for a public client and for any instance whose client is not the installer's.",
    }),

    status: Field.select(['connected', 'reconnect_required'], {
      label: 'Status',
      required: true,
      defaultValue: 'connected',
      description:
        "`connected` while the grant works; `reconnect_required` once the grant stopped working: the authorization server refused it on refresh, the connection keeps nothing to renew an access token it has to renew with (no refresh token was issued, or no client to refresh with), or the upstream refused the connection's token while an `mcp` instance discovered its tools. `status_reason` says which. Only a new connect returns it to `connected`.",
    }),

    status_reason: Field.textarea({
      label: 'Status Reason',
      readonly: true,
      description: 'Why the grant stopped working, in the platform\'s words. Never a token, and never the authorization server\'s own text.',
    }),

    scopes: Field.textarea({
      label: 'Scopes',
      readonly: true,
      description: 'The scopes the authorization server granted, space-separated, as it answered them.',
    }),

    expires_at: Field.datetime({
      label: 'Access Expires At',
      readonly: true,
      description: 'When the access token last obtained for this connection expires. The token itself is never stored.',
    }),

    revision: Field.number({
      label: 'Revision',
      required: true,
      readonly: true,
      defaultValue: 1,
      description: 'Raised on every write of the refresh token: a refresh writes the rotated token only over the revision it read, so a rotated token is never overwritten by a stale one.',
    }),

    connected_at: Field.datetime({
      label: 'Connected At',
      readonly: true,
      description: 'When an administrator last connected or reconnected this instance for the organization.',
    }),

    connected_by: Field.text({
      label: 'Connected By',
      readonly: true,
      maxLength: 255,
      description: 'The user id that last connected or reconnected it.',
    }),
  },

  indexes: [
    // One connection per instance in an organization — the connect door's
    // upsert key (ADR-0143 Q1 = A).
    { fields: ['connector_name'], unique: 'organization' },
  ],

  enable: {
    // Engine-owned and write-only: no generic data door at all. The refresh
    // token is masked on every engine read regardless.
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
