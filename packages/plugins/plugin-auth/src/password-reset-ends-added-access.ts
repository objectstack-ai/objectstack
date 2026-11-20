// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A password reset ends what the account added before it; a password change
 * reminds the account what it keeps.
 *
 * ## The rule
 *
 * A completed self-service password reset — the emailed link
 * (`/reset-password`) or the texted code (`/phone-number/reset-password`) —
 * ends, for the account it reset, the ways in the account held besides its
 * password before the reset:
 *
 *  - **every API key it owns** (`sys_api_key`) that the key-admission seam
 *    (`resolveApiKeyAdmission`) would admit — a `revoked` flag that is false,
 *    or null, which the seam reads as live — is written `revoked: true`, the
 *    flag the seam refuses, so the very next call with the key is refused
 *    (`403 API_KEY_REVOKED`). It records no `revoked_reason`, as a key its
 *    owner revokes records none (`api-key-restore-guard.ts`);
 *  - **every sign-in account linked to it other than its password**
 *    (`sys_account` rows of a provider other than `credential`: a social,
 *    generic OAuth or single-sign-on link), deleted through better-auth's
 *    internal adapter, so every account-delete hook runs; a link a hook keeps
 *    is not ended, and the reset answers an error. Nothing is recorded
 *    against linking again: the unlink record `implicit-account-linking.ts`
 *    writes is the user's own `/unlink-account`'s, so a provider may link
 *    again exactly as it could before it was ever linked;
 *  - **every app authorized to it**, where the OAuth provider is mounted: its
 *    stored consents, refresh tokens and stored access tokens
 *    (`sys_oauth_consent`, `sys_oauth_refresh_token`,
 *    `sys_oauth_access_token`), deleted through better-auth's storage
 *    adapter, the store the provider reads them from. An access token the
 *    provider signs as a JWT is stored nowhere; the MCP door reads its
 *    consent on every request and refuses it once the consent is gone
 *    (`mcp-token-revocation.ts`);
 *  - **every device sign-in approved for it and not yet collected**
 *    (`sys_device_code` rows that name it), where device authorization is
 *    mounted: the device's next poll finds no code;
 *  - **every OAuth application it registered** (`sys_oauth_application` rows
 *    whose `user_id` is the account) that is not disabled — a `disabled`
 *    flag false, or null, which the provider reads as enabled — is written
 *    `disabled: true`, the flag the provider and the MCP door refuse, as the
 *    platform administrator's Disable action writes it: the provider issues
 *    the app no token, answers its tokens inactive at introspection, and the
 *    MCP door refuses every token it holds, whoever authorized it
 *    (`mcp-token-revocation.ts`). Disabling is reversible: a platform
 *    administrator enables the app again (`/admin/oauth2/toggle-disabled`);
 *    its owner cannot. An app another account registered, and one
 *    registered with no owner, is not touched;
 *  - **every SCIM provisioning credential it minted**
 *    (`sys_scim_connection_credential` rows whose `user_id` is the account)
 *    that is still active is revoked through the one revoke a platform
 *    administrator uses (`revokeScimConnectionCredential`): its bearer is
 *    refused from the next SCIM request on, and a revoke is one-way, so
 *    provisioning through that connection pauses until a platform
 *    administrator mints a new credential. A credential another
 *    administrator minted for the same connection is not touched;
 *  - **passkeys: none to end.** The plugin's `passkeys` flag is wired to no
 *    plugin and no passkey store is mounted (`invitation-mailbox-proof.ts`,
 *    `USER_KEYED_STORES`). A passkey store mounted later belongs in this list.
 *
 * The OAuth and device stores are named by {@link OAUTH_GRANT_STORES}, each
 * one of the stores `USER_KEYED_STORES` keys by the account. A deployment that
 * mounts neither plugin reads none of them. The registered apps and the
 * minted credentials are read and written through the data engine, the store
 * the Disable action and the credential door write them through, by their
 * object and its `user_id` column ({@link endWhatTheAccountRegistered}): a
 * row is the account's whether or not its plugin is mounted now, and an
 * object the deployment does not hold, or a table it never created, holds
 * none (`isObjectAbsentError`, asked with the object read).
 *
 * Two things the account set up are KEPT: the single sign-on providers it
 * registered (`sys_sso_provider.user_id`) and its second-factor enrolment
 * (`sys_two_factor`, `sys_user.two_factor_enabled`). A reset names them to the
 * account instead, so their owner can check them ({@link whatAResetKeeps}).
 *
 * The account's sessions are ended by the reset doors themselves, before and
 * again after the password write (`credential-change-ends-prior-access.ts`).
 * Once it has ended these, a completed self-service reset mails the account
 * `auth.password_reset_notice`: what it ended, each app it disabled and each
 * credential it revoked by name, and the single sign-on providers and the
 * second factor it kept. The notice is best-effort, like the change reminder
 * below: one that cannot be read or sent never fails the reset.
 *
 * A password CHANGE (`/change-password`, which proves the current password)
 * ends none of these. It reminds instead: when the account still holds an API
 * key the seam would admit (not revoked, its own expiry not passed), a linked
 * sign-in account, an authorized app, an enabled OAuth application it
 * registered or an active SCIM credential it minted once its password has
 * changed, the account's address is sent `auth.password_changed_notice`,
 * listing them, through the mail service every auth notice goes through. The
 * reminder is best-effort, like the email-change notice: a reminder that
 * cannot be read or sent never fails the change.
 *
 * An administrator's forced reset (`/admin/set-user-password` with its
 * revocation switch on, the default) and the operator's reset
 * (`os user set-password`) end the keys, the linked sign-in accounts, the
 * authorized apps and device sign-ins, the registered apps and the minted
 * credentials beside the sessions they end, through
 * `forced-reset-revocation.ts`, which ends the grants with this module's
 * {@link endOAuthGrants} and the registrations with
 * {@link endWhatTheAccountRegistered}. They send no notice: each answers its
 * requester what it ended (the response's `revoked` and the ledger row; the
 * command's outcome), and the operator's command runs with no server and no
 * mail service. An
 * administrator who turns the switch off (`revokeSessionsAndKeys: false`)
 * asks for a routine reset, and nothing is ended: the switch is the reason
 * that reset is not treated as a self-service one. The one-step invitation
 * door sets the password only of an account that holds no sign-in and no
 * standing grant (it answers `sign_in` to any other), so it has nothing of
 * this to end.
 *
 * ## Where, and how it fails
 *
 * In the global after-hook (`auth-manager-after-hook.ts`), on a reset door's
 * success, for the account the before-hook named (`RESET_DOOR_SUBJECT`): the
 * password is written by then, so a reset that does not complete ends
 * nothing. A completed reset whose account cannot be named, and a read or a
 * write that fails, are not swallowed: the error reaches the requester, and
 * the next completed reset ends what remains. Without a data engine the
 * deployment holds no `sys_api_key`, `sys_oauth_application` or
 * `sys_scim_connection_credential` store, so there is no key, registered app
 * or minted credential to end; the sign-in accounts and the OAuth grants are
 * read through the vendor's adapter either way.
 */

import { isExpired } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';
import { isMissingTableError, isObjectAbsentError } from '@objectstack/types';
import type { USER_KEYED_STORES } from './invitation-mailbox-proof.js';
import { SCIM_CREDENTIAL_OBJECT, revokeScimConnectionCredential } from './scim-connection-service.js';

/** The provider id of the account's local password row. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** How many keys one read asks for; the read repeats until none is left. */
const API_KEY_PAGE = 500;

/** How many consents one read of the reminder asks for; it reads on while a page comes back full. */
const OAUTH_CONSENT_PAGE = 100;

/** How many registered apps, minted credentials or kept providers one read asks for. */
const REGISTRATION_PAGE = 500;

/** The single sign-on providers an account registered, which a reset keeps. */
const SSO_PROVIDER_OBJECT = 'sys_sso_provider';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of better-auth's internal adapter the sign-in accounts are read and deleted through. */
export interface SignInAccountStore {
  findAccounts(userId: string): Promise<Array<{ id?: unknown; providerId?: unknown }> | null | undefined>;
  deleteAccount(id: string): Promise<unknown>;
}

/** The slice of the data engine the API keys are read and written through. */
export interface ApiKeyStore {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

/**
 * The slice of better-auth's storage adapter (`$context.adapter`) the OAuth
 * grants are read and deleted through, with the provider's own model and
 * field names (as `mcp-token-revocation.ts` reads them).
 */
export interface OAuthGrantRows {
  findMany(query: {
    model: string;
    where: Array<{ field: string; value: unknown; operator?: 'in' }>;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
  delete(query: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown>;
}

/** The OAuth grants {@link endOAuthGrants} ended: counts of rows really deleted. */
export type EndedOAuthGrants = Pick<ResetEndedAccess, 'authorizedApps' | 'oauthTokens' | 'deviceCodes'>;

/**
 * Where the account's OAuth grants are kept: the vendor's storage adapter,
 * and whether the plugin of a given id is mounted (read off the vendor's own
 * plugin registry, `getPlugin`, in the after-hook).
 */
export interface MountedOAuthGrants {
  store: OAuthGrantRows | undefined;
  mounted(pluginId: string): boolean;
}

/**
 * The slice of the data engine the OAuth applications an account registered
 * and the SCIM credentials it minted are read and written through: the reads,
 * the `disabled` write, and the credential revoke's own read and write
 * (`revokeScimConnectionCredential`).
 */
export type RegistrationStore = Parameters<typeof revokeScimConnectionCredential>[0] & {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
};

/** The stores a completed reset reads and writes. */
export interface ResetStores {
  accounts: SignInAccountStore;
  apiKeys: ApiKeyStore | undefined;
  oauth?: MountedOAuthGrants;
  /** The data engine the registered apps and minted credentials live in; absent ⇒ none to end. */
  registrations?: RegistrationStore | undefined;
}

/** What a completed reset ended: counts of rows really written. */
export interface ResetEndedAccess {
  apiKeys: number;
  signInAccounts: number;
  /** Stored consents: the apps the account authorized. */
  authorizedApps: number;
  /** Refresh tokens and stored access tokens. */
  oauthTokens: number;
  /** Device sign-ins approved and not yet collected. */
  deviceCodes: number;
  /** The OAuth applications the account registered, now disabled: each by its name ({@link EndedRegistrations}). */
  ownedApps: string[];
  /** The SCIM connection credentials the account minted, now revoked: each by its connection ({@link EndedRegistrations}). */
  scimCredentials: string[];
}

/** What {@link endWhatTheAccountRegistered} disabled and revoked, each named as it was ended. */
export type EndedRegistrations = Pick<ResetEndedAccess, 'ownedApps' | 'scimCredentials'>;

/** What a reset keeps of what the account set up, named so its owner can check each ({@link whatAResetKeeps}). */
export interface WhatAResetKeeps {
  /** The single sign-on providers the account registered, by provider id. */
  ssoProviders: string[];
  /** Whether the account is enrolled in a second factor (`sys_user.two_factor_enabled`). */
  twoFactor: boolean;
}

/**
 * The OAuth grants a completed reset ends, in the order it ends them: each
 * one of the stores `USER_KEYED_STORES` keys by the account
 * (`invitation-mailbox-proof.ts`), read and deleted as the model better-auth
 * stores it under (field `userId`), and only where the plugin that mounts it
 * is mounted. The consent goes first: it is the record the MCP door reads on
 * every request.
 */
export const OAUTH_GRANT_STORES = [
  { store: 'sys_oauth_consent.user_id', model: 'oauthConsent', plugin: 'oauth-provider', counts: 'authorizedApps' },
  { store: 'sys_oauth_refresh_token.user_id', model: 'oauthRefreshToken', plugin: 'oauth-provider', counts: 'oauthTokens' },
  { store: 'sys_oauth_access_token.user_id', model: 'oauthAccessToken', plugin: 'oauth-provider', counts: 'oauthTokens' },
  { store: 'sys_device_code.user_id', model: 'deviceCode', plugin: 'device-authorization', counts: 'deviceCodes' },
] as const satisfies ReadonlyArray<{
  store: keyof typeof USER_KEYED_STORES;
  model: string;
  plugin: string;
  counts: keyof EndedOAuthGrants;
}>;

/** What a password change leaves active, for its reminder. */
export interface AccessAPasswordChangeKeeps {
  /** Each API key the admission seam would admit, by its name (its prefix when it has none). */
  apiKeys: string[];
  /** Each linked sign-in account, by its provider id. */
  signInAccounts: string[];
  /** Each app the account authorized (a stored consent), by its client's name (its client id when it has none). */
  authorizedApps: string[];
  /** Each OAuth application the account registered that is not disabled, by its name (its client id when it has none). */
  ownedApps: string[];
  /** Each SCIM credential the account minted that is still active, by its connection (and label). */
  scimCredentials: string[];
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const value = (result as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/** The account's sign-in accounts other than its password. */
async function linkedSignInAccounts(
  store: SignInAccountStore,
  userId: string,
): Promise<Array<{ id: string; providerId: string }>> {
  const accounts = (await store.findAccounts(userId)) ?? [];
  const linked: Array<{ id: string; providerId: string }> = [];
  for (const account of accounts) {
    const id = account?.id;
    const providerId = account?.providerId;
    if (typeof providerId !== 'string' || providerId === CREDENTIAL_PROVIDER_ID) continue;
    if (typeof id !== 'string' || id.length === 0) throw new Error(`a ${providerId} sign-in account carries no id`);
    linked.push({ id, providerId });
  }
  return linked;
}

/**
 * The `where` of the account's API keys the admission seam would admit as
 * far as their flag goes: `revoked` false, or null (`sys-api-key.object.ts`:
 * a null `revoked` reads as live; the seam refuses only `true` and `1`).
 */
function liveKeysOf(userId: string): Record<string, unknown> {
  return { user_id: userId, $or: [{ revoked: false }, { revoked: null }] };
}

/** Whether a key row's flag is one the admission seam refuses. */
function isRevoked(row: Record<string, unknown>): boolean {
  return row.revoked === true || row.revoked === 1;
}

/**
 * The account's API keys whose flag the admission seam admits: one page, or
 * the page at `offset` in id order.
 */
async function unrevokedApiKeys(engine: ApiKeyStore, userId: string, offset?: number): Promise<Array<Record<string, unknown>>> {
  const page = rowsOf(
    await engine.find(
      SystemObjectName.API_KEY,
      {
        where: liveKeysOf(userId),
        fields: ['id', 'name', 'prefix', 'revoked', 'expires_at'],
        limit: API_KEY_PAGE,
        ...(offset === undefined ? {} : { orderBy: [{ field: 'id', order: 'asc' }], offset }),
      },
      { context: SYSTEM_CTX },
    ),
  );
  return page.filter((row) => !isRevoked(row));
}

/**
 * Delete every `model` row that names `userId` through the vendor's adapter,
 * reading again until a read answers none; `deleted` is called once for each
 * row deleted, as it is deleted. A row a pass deleted and the next read still
 * answers was not deleted, which is a failure, never a loop.
 */
async function endGrantRows(store: OAuthGrantRows, model: string, userId: string, deleted: () => void): Promise<void> {
  const ids = new Set<string>();
  for (;;) {
    const rows = (await store.findMany({ model, where: [{ field: 'userId', value: userId }] })) ?? [];
    if (rows.length === 0) return;
    for (const row of rows) {
      const id: unknown = (row as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error(`a ${model} row carries no id`);
      if (ids.has(id)) throw new Error(`${model} row ${id} still reads after it was deleted`);
      await store.delete({ model, where: [{ field: 'id', value: id }] });
      ids.add(id);
      deleted();
    }
  }
}

/**
 * End every OAuth grant and approved device sign-in of `userId`, in
 * {@link OAUTH_GRANT_STORES} order, in each store whose plugin `oauth` says is
 * mounted; no `oauth`, nothing. The arm a completed self-service reset and the
 * forced resets (`forced-reset-revocation.ts`) share. Counts each row into
 * `ended` as it is deleted, so a caller that hands its own tally still holds
 * what was ended when a later store fails. Throws when a read or a delete
 * fails, a mounted plugin's store cannot be reached, or a row survives its
 * delete.
 */
export async function endOAuthGrants(
  oauth: MountedOAuthGrants | undefined,
  userId: string,
  ended: EndedOAuthGrants = { authorizedApps: 0, oauthTokens: 0, deviceCodes: 0 },
): Promise<EndedOAuthGrants> {
  for (const grant of OAUTH_GRANT_STORES) {
    if (!oauth?.mounted(grant.plugin)) continue;
    const store = oauth.store;
    if (!store) throw new Error(`the ${grant.model} store of a mounted ${grant.plugin} cannot be reached`);
    await endGrantRows(store, grant.model, userId, () => {
      ended[grant.counts] += 1;
    });
  }
  return ended;
}

/** The slice of the data engine {@link storedOAuthGrants} reads and deletes the grant stores through. */
export interface OAuthGrantEngine {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  delete?(object: string, options?: unknown): Promise<unknown>;
}

/**
 * The account's OAuth grants as the project database holds them, for a reset
 * run with no auth server in reach (the operator's `os user set-password`):
 * each {@link OAUTH_GRANT_STORES} store read and deleted through the data
 * engine, by its object and its user column (the `store` key). With no
 * plugin registry to ask, every store counts as mounted: a grant row is the
 * account's whether or not its plugin is mounted now, and a store whose table
 * the database does not hold has no row to end.
 */
export function storedOAuthGrants(engine: OAuthGrantEngine): MountedOAuthGrants {
  const placeOf = (model: string): { object: string; column: string } => {
    const grant = OAUTH_GRANT_STORES.find((g) => g.model === model);
    if (!grant) throw new Error(`${model} is not an OAuth grant store`);
    const [object, column] = grant.store.split('.') as [string, string];
    return { object, column };
  };
  const valueOf = (where: Array<{ field: string; value: unknown }>, field: string): unknown =>
    where.find((clause) => clause.field === field)?.value;
  return {
    mounted: () => true,
    store: {
      async findMany({ model, where, limit }) {
        const { object, column } = placeOf(model);
        try {
          return rowsOf(
            await engine.find(
              object,
              { where: { [column]: valueOf(where, 'userId') }, fields: ['id'], limit: limit ?? API_KEY_PAGE },
              { context: SYSTEM_CTX },
            ),
          );
        } catch (error) {
          if (isMissingTableError(error, object)) return [];
          throw error;
        }
      },
      async delete({ model, where }) {
        const { object } = placeOf(model);
        if (typeof engine.delete !== 'function') throw new Error(`the data engine cannot delete ${object} rows`);
        return engine.delete(object, { where: { id: valueOf(where, 'id') }, context: SYSTEM_CTX });
      },
    },
  };
}

/**
 * The rows of `object` a `query` answers, read as the system; an object the
 * deployment does not hold, or whose table it never created, holds none. Any
 * other failure is thrown.
 */
async function rowsOrNone(engine: Pick<RegistrationStore, 'find'>, object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  try {
    return rowsOf(await engine.find(object, query, { context: SYSTEM_CTX }));
  } catch (error) {
    if (isObjectAbsentError(error, object)) return [];
    throw error;
  }
}

/** Whether a stored boolean flag is on: `true`, or the `1` a SQLite column hands back. */
function isOn(value: unknown): boolean {
  return value === true || value === 1;
}

/** An OAuth application row by its name, else its client id, else its id. */
function nameOfApp(row: Record<string, unknown>): string {
  for (const value of [row.name, row.client_id, row.id]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** A SCIM credential row by its connection, and its label when it has one. */
function nameOfCredential(row: Record<string, unknown>): string {
  const connection = typeof row.connection_id === 'string' && row.connection_id ? row.connection_id : String(row.id ?? '');
  const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : undefined;
  return label ? `${connection} (${label})` : connection;
}

/**
 * The `where` of the OAuth applications `userId` registered that the provider
 * would serve as far as their flag goes: `disabled` false, or null (better-auth
 * writes the column only when it is set, and the provider refuses only a
 * truthy one).
 */
function enabledAppsOf(userId: string): Record<string, unknown> {
  return { user_id: userId, $or: [{ disabled: false }, { disabled: null }] };
}

/** The OAuth applications `userId` registered that are not disabled: one page, or the page at `offset` in id order. */
async function enabledOwnedApps(engine: Pick<RegistrationStore, 'find'>, userId: string, offset?: number): Promise<Array<Record<string, unknown>>> {
  const page = await rowsOrNone(engine, SystemObjectName.OAUTH_APPLICATION, {
    where: enabledAppsOf(userId),
    fields: ['id', 'name', 'client_id', 'disabled'],
    limit: REGISTRATION_PAGE,
    ...(offset === undefined ? {} : { orderBy: [{ field: 'id', order: 'asc' }], offset }),
  });
  return page.filter((row) => !isOn(row.disabled));
}

/** The SCIM credentials `userId` minted that are still active: one page, or the page at `offset` in id order. */
async function activeMintedCredentials(engine: Pick<RegistrationStore, 'find'>, userId: string, offset?: number): Promise<Array<Record<string, unknown>>> {
  const page = await rowsOrNone(engine, SCIM_CREDENTIAL_OBJECT, {
    where: { user_id: userId, active: true },
    fields: ['id', 'connection_id', 'label', 'active'],
    limit: REGISTRATION_PAGE,
    ...(offset === undefined ? {} : { orderBy: [{ field: 'id', order: 'asc' }], offset }),
  });
  return page.filter((row) => isOn(row.active));
}

/**
 * Disable every OAuth application `userId` registered and revoke every SCIM
 * connection credential it minted (module header): the arm every reset
 * shares, the self-service reset, the administrator's forced reset and the
 * operator's (`forced-reset-revocation.ts`). Each is read through the data
 * engine by its `user_id`, so an app another account registered and a
 * credential another administrator minted are never read.
 *
 * An app is written `disabled: true`, with the whole-second `updated_at` the
 * Disable action writes beside it (`/admin/oauth2/toggle-disabled`); a
 * credential is revoked by `revokeScimConnectionCredential`, the
 * administrator's own revoke. Each read repeats until it answers none, and
 * each row is named into `ended` as it is ended, so a caller that hands its
 * own tally still holds what was ended when a later write fails. A row a pass
 * ended and the next read still answers was not ended, which is a failure,
 * never a loop. No engine, nothing to end. Throws when a read or a write
 * fails, once both the apps and the credentials have been tried.
 */
export async function endWhatTheAccountRegistered(
  engine: RegistrationStore | undefined,
  userId: string,
  ended: EndedRegistrations = { ownedApps: [], scimCredentials: [] },
): Promise<EndedRegistrations> {
  if (!engine) return ended;
  // The credentials are revoked though an app could not be disabled, and the
  // first failure is thrown once both have run: a failure ends no less.
  let failure: { error: unknown } | undefined;
  try {
    await disableOwnedApps(engine, userId, ended);
  } catch (error) {
    failure = { error };
  }
  try {
    await revokeMintedCredentials(engine, userId, ended);
  } catch (error) {
    failure ??= { error };
  }
  if (failure) throw failure.error;
  return ended;
}

/** {@link endWhatTheAccountRegistered}'s apps: each read repeats until it answers none. */
async function disableOwnedApps(engine: RegistrationStore, userId: string, ended: EndedRegistrations): Promise<void> {
  const disabled = new Set<string>();
  for (;;) {
    const page = await enabledOwnedApps(engine, userId);
    if (page.length === 0) return;
    for (const row of page) {
      const id = row.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error('an OAuth application row carries no id');
      if (disabled.has(id)) throw new Error(`OAuth application ${id} still reads enabled after it was disabled`);
      await engine.update(
        SystemObjectName.OAUTH_APPLICATION,
        { id, disabled: true, updated_at: new Date(Math.floor(Date.now() / 1000) * 1000) },
        { context: SYSTEM_CTX },
      );
      disabled.add(id);
      ended.ownedApps.push(nameOfApp(row));
    }
  }
}

/** {@link endWhatTheAccountRegistered}'s credentials: each read repeats until it answers none. */
async function revokeMintedCredentials(engine: RegistrationStore, userId: string, ended: EndedRegistrations): Promise<void> {
  const revoked = new Set<string>();
  for (;;) {
    const page = await activeMintedCredentials(engine, userId);
    if (page.length === 0) return;
    for (const row of page) {
      const id = row.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error('a SCIM connection credential row carries no id');
      if (revoked.has(id)) throw new Error(`SCIM connection credential ${id} still reads active after it was revoked`);
      const outcome = await revokeScimConnectionCredential(engine, id);
      revoked.add(id);
      // A credential revoked or removed between the read and the revoke is
      // not this reset's to count.
      if (outcome.outcome === 'revoked') ended.scimCredentials.push(nameOfCredential(row));
    }
  }
}

/**
 * What a reset keeps of what `userId` set up, for its notice: the single
 * sign-on providers it registered (`sys_sso_provider.user_id`, by provider
 * id) and whether it is enrolled in a second factor
 * (`sys_user.two_factor_enabled`). Read through the data engine; an object
 * the deployment does not hold holds none. No engine, none. Throws when a
 * read fails.
 */
export async function whatAResetKeeps(engine: Pick<RegistrationStore, 'find'> | undefined, userId: string): Promise<WhatAResetKeeps> {
  if (!engine) return { ssoProviders: [], twoFactor: false };
  const ssoProviders: string[] = [];
  for (let offset = 0; ; offset += REGISTRATION_PAGE) {
    const page = await rowsOrNone(engine, SSO_PROVIDER_OBJECT, {
      where: { user_id: userId },
      fields: ['id', 'provider_id', 'domain'],
      limit: REGISTRATION_PAGE,
      orderBy: [{ field: 'id', order: 'asc' }],
      offset,
    });
    for (const row of page) {
      const providerId = typeof row.provider_id === 'string' && row.provider_id ? row.provider_id : String(row.id ?? '');
      if (providerId) ssoProviders.push(providerId);
    }
    if (page.length < REGISTRATION_PAGE) break;
  }
  const [user] = await rowsOrNone(engine, SystemObjectName.USER, {
    where: { id: userId },
    fields: ['id', 'two_factor_enabled'],
    limit: 1,
  });
  return { ssoProviders, twoFactor: isOn(user?.two_factor_enabled) };
}

/**
 * End what a completed self-service reset ends for `userId` (module header):
 * every linked sign-in account other than the password, where their plugins
 * are mounted every OAuth grant and approved device sign-in, every OAuth
 * application it registered and every SCIM credential it minted, and every
 * API key. Throws when a read or a write fails, or a row survives its
 * delete, so the requester is told.
 */
export async function endWhatTheAccountAddedBeforeAReset(stores: ResetStores, userId: string): Promise<ResetEndedAccess> {
  const ended: ResetEndedAccess = {
    apiKeys: 0,
    signInAccounts: 0,
    authorizedApps: 0,
    oauthTokens: 0,
    deviceCodes: 0,
    ownedApps: [],
    scimCredentials: [],
  };
  // Each pass deletes what the read answered; a link a delete hook kept
  // reads again, which is a failure.
  const unlinked = new Set<string>();
  for (;;) {
    const linked = await linkedSignInAccounts(stores.accounts, userId);
    if (linked.length === 0) break;
    for (const account of linked) {
      if (unlinked.has(account.id)) throw new Error(`sign-in account ${account.id} is still linked after it was unlinked`);
      await stores.accounts.deleteAccount(account.id);
      unlinked.add(account.id);
    }
  }
  ended.signInAccounts = unlinked.size;
  await endOAuthGrants(stores.oauth, userId, ended);
  await endWhatTheAccountRegistered(stores.registrations, userId, ended);
  const engine: ApiKeyStore | undefined = stores.apiKeys;
  if (!engine) return ended;
  // Each pass revokes what the read answered, and the next read no longer
  // answers it; a key that a pass revoked and the next read still answers was
  // not revoked, which is a failure, never a loop.
  const revoked = new Set<string>();
  for (;;) {
    const page = await unrevokedApiKeys(engine, userId);
    if (page.length === 0) return ended;
    for (const row of page) {
      const id = row.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error('an API key row carries no id');
      if (revoked.has(id)) throw new Error(`API key ${id} still reads unrevoked after it was revoked`);
      await engine.update(SystemObjectName.API_KEY, { id, revoked: true }, { context: SYSTEM_CTX });
      revoked.add(id);
      ended.apiKeys += 1;
    }
  }
}

/** The apps `userId` authorized, by their clients' names, read page by page through the vendor's adapter. */
async function authorizedApps(store: OAuthGrantRows, userId: string): Promise<string[]> {
  const clientIds: string[] = [];
  for (let offset = 0; ; offset += OAUTH_CONSENT_PAGE) {
    const page = (await store.findMany({ model: 'oauthConsent', where: [{ field: 'userId', value: userId }], limit: OAUTH_CONSENT_PAGE, offset })) ?? [];
    for (const consent of page) {
      const clientId: unknown = (consent as { clientId?: unknown } | null)?.clientId;
      if (typeof clientId === 'string' && clientId.length > 0 && !clientIds.includes(clientId)) clientIds.push(clientId);
    }
    if (page.length < OAUTH_CONSENT_PAGE) break;
  }
  // The clients' names, one read per page of client ids (`in`, as
  // `mcp-token-revocation.ts` reads a refresh family), not one per app.
  const nameOf = new Map<string, string>();
  for (let start = 0; start < clientIds.length; start += OAUTH_CONSENT_PAGE) {
    const page = clientIds.slice(start, start + OAUTH_CONSENT_PAGE);
    const clients = (await store.findMany({ model: 'oauthClient', where: [{ field: 'clientId', operator: 'in', value: page }], limit: page.length })) ?? [];
    for (const client of clients) {
      const { clientId, name } = (client ?? {}) as { clientId?: unknown; name?: unknown };
      if (typeof clientId === 'string' && typeof name === 'string' && name.trim()) nameOf.set(clientId, name.trim());
    }
  }
  return clientIds.map((clientId) => nameOf.get(clientId) ?? clientId);
}

/**
 * What a password change leaves active for `userId`: its API keys the
 * admission seam would admit (not revoked, its own expiry not passed), its
 * linked sign-in accounts, the apps it authorized where the OAuth provider is
 * mounted, and the OAuth applications it registered that are not disabled
 * and the SCIM credentials it minted that are still active, for the
 * reminder. Throws when a read fails.
 */
export async function accessAPasswordChangeKeeps(stores: ResetStores, userId: string): Promise<AccessAPasswordChangeKeeps> {
  const signInAccounts = (await linkedSignInAccounts(stores.accounts, userId)).map((a) => a.providerId);
  const apiKeys: string[] = [];
  if (stores.apiKeys) {
    const nowMs = Date.now();
    for (let offset = 0; ; offset += API_KEY_PAGE) {
      const page = await unrevokedApiKeys(stores.apiKeys, userId, offset);
      for (const row of page) {
        if (isExpired(row.expires_at, nowMs)) continue;
        const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : undefined;
        const prefix = typeof row.prefix === 'string' && row.prefix ? `${row.prefix}…` : undefined;
        apiKeys.push(name ?? prefix ?? String(row.id));
      }
      if (page.length < API_KEY_PAGE) break;
    }
  }
  const oauth = stores.oauth;
  const apps = oauth?.store && oauth.mounted('oauth-provider') ? await authorizedApps(oauth.store, userId) : [];
  const ownedApps: string[] = [];
  const scimCredentials: string[] = [];
  const engine = stores.registrations;
  if (engine) {
    for (let offset = 0; ; offset += REGISTRATION_PAGE) {
      const page = await enabledOwnedApps(engine, userId, offset);
      ownedApps.push(...page.map(nameOfApp));
      if (page.length < REGISTRATION_PAGE) break;
    }
    for (let offset = 0; ; offset += REGISTRATION_PAGE) {
      const page = await activeMintedCredentials(engine, userId, offset);
      scimCredentials.push(...page.map(nameOfCredential));
      if (page.length < REGISTRATION_PAGE) break;
    }
  }
  return { apiKeys, signInAccounts, authorizedApps: apps, ownedApps, scimCredentials };
}
