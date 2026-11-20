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
 *  - **passkeys: none to end.** The plugin's `passkeys` flag is wired to no
 *    plugin and no passkey store is mounted (`invitation-mailbox-proof.ts`,
 *    `USER_KEYED_STORES`). A passkey store mounted later belongs in this list.
 *
 * The OAuth and device stores are named by {@link OAUTH_GRANT_STORES}, each
 * one of the stores `USER_KEYED_STORES` keys by the account. A deployment that
 * mounts neither plugin reads none of them.
 *
 * The account's sessions are ended by the reset doors themselves, before and
 * again after the password write (`credential-change-ends-prior-access.ts`).
 *
 * A password CHANGE (`/change-password`, which proves the current password)
 * ends none of these. It reminds instead: when the account still holds an API
 * key the seam would admit (not revoked, its own expiry not passed), a linked
 * sign-in account or an authorized app once its password has changed, the
 * account's address is sent `auth.password_changed_notice`, listing them,
 * through the mail service every auth notice goes through. The reminder is
 * best-effort, like the email-change notice: a reminder that cannot be read
 * or sent never fails the change.
 *
 * An administrator's forced reset (`/admin/set-user-password` with its
 * revocation switch on, the default) and the operator's reset
 * (`os user set-password`) end the keys, the linked sign-in accounts and the
 * authorized apps and device sign-ins beside the sessions they end, through
 * `forced-reset-revocation.ts`, which ends the last two with this module's
 * {@link endOAuthGrants}. An
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
 * deployment holds no `sys_api_key` store, so there is no key to end; the
 * sign-in accounts and the OAuth grants are read through the vendor's
 * adapter either way.
 */

import { isExpired } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';
import { isMissingTableError } from '@objectstack/types';
import type { USER_KEYED_STORES } from './invitation-mailbox-proof.js';

/** The provider id of the account's local password row. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** How many keys one read asks for; the read repeats until none is left. */
const API_KEY_PAGE = 500;

/** How many consents one read of the reminder asks for; it reads on while a page comes back full. */
const OAUTH_CONSENT_PAGE = 100;

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
  findMany(query: { model: string; where: Array<{ field: string; value: unknown }>; limit?: number; offset?: number }): Promise<unknown[]>;
  findOne(query: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown>;
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

/** The stores a completed reset reads and writes. */
export interface ResetStores {
  accounts: SignInAccountStore;
  apiKeys: ApiKeyStore | undefined;
  oauth?: MountedOAuthGrants;
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
  counts: Exclude<keyof ResetEndedAccess, 'apiKeys' | 'signInAccounts'>;
}>;

/** What a password change leaves active, for its reminder. */
export interface AccessAPasswordChangeKeeps {
  /** Each API key the admission seam would admit, by its name (its prefix when it has none). */
  apiKeys: string[];
  /** Each linked sign-in account, by its provider id. */
  signInAccounts: string[];
  /** Each app the account authorized (a stored consent), by its client's name (its client id when it has none). */
  authorizedApps: string[];
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
 * reading again until a read answers none; answers how many were deleted. A
 * row a pass deleted and the next read still answers was not deleted, which
 * is a failure, never a loop.
 */
async function endGrantRows(store: OAuthGrantRows, model: string, userId: string): Promise<number> {
  const deleted = new Set<string>();
  for (;;) {
    const rows = (await store.findMany({ model, where: [{ field: 'userId', value: userId }] })) ?? [];
    if (rows.length === 0) return deleted.size;
    for (const row of rows) {
      const id: unknown = (row as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error(`a ${model} row carries no id`);
      if (deleted.has(id)) throw new Error(`${model} row ${id} still reads after it was deleted`);
      await store.delete({ model, where: [{ field: 'id', value: id }] });
      deleted.add(id);
    }
  }
}

/**
 * End every OAuth grant and approved device sign-in of `userId`, in
 * {@link OAUTH_GRANT_STORES} order, in each store whose plugin `oauth` says is
 * mounted; no `oauth`, nothing. The arm a completed self-service reset and the
 * forced resets (`forced-reset-revocation.ts`) share. Throws when a read or a
 * delete fails, a mounted plugin's store cannot be reached, or a row survives
 * its delete.
 */
export async function endOAuthGrants(oauth: MountedOAuthGrants | undefined, userId: string): Promise<EndedOAuthGrants> {
  const ended: EndedOAuthGrants = { authorizedApps: 0, oauthTokens: 0, deviceCodes: 0 };
  for (const grant of OAUTH_GRANT_STORES) {
    if (!oauth?.mounted(grant.plugin)) continue;
    const store = oauth.store;
    if (!store) throw new Error(`the ${grant.model} store of a mounted ${grant.plugin} cannot be reached`);
    ended[grant.counts] += await endGrantRows(store, grant.model, userId);
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
          if (isMissingTableError(error)) return [];
          throw error;
        }
      },
      async findOne({ model, where }) {
        const { object } = placeOf(model);
        const rows = rowsOf(await engine.find(object, { where: { id: valueOf(where, 'id') }, fields: ['id'], limit: 1 }, { context: SYSTEM_CTX }));
        return rows[0] ?? null;
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
 * End what a completed self-service reset ends for `userId` (module header):
 * every linked sign-in account other than the password, every API key, and,
 * where their plugins are mounted, every OAuth grant and approved device
 * sign-in. Throws when a read or a write fails, or a row survives its
 * delete, so the requester is told.
 */
export async function endWhatTheAccountAddedBeforeAReset(stores: ResetStores, userId: string): Promise<ResetEndedAccess> {
  const ended: ResetEndedAccess = { apiKeys: 0, signInAccounts: 0, authorizedApps: 0, oauthTokens: 0, deviceCodes: 0 };
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
  Object.assign(ended, await endOAuthGrants(stores.oauth, userId));
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
  const names: string[] = [];
  for (const clientId of clientIds) {
    const client = (await store.findOne({ model: 'oauthClient', where: [{ field: 'clientId', value: clientId }] })) as { name?: unknown } | null;
    names.push(typeof client?.name === 'string' && client.name.trim() ? client.name.trim() : clientId);
  }
  return names;
}

/**
 * What a password change leaves active for `userId`: its API keys the
 * admission seam would admit (not revoked, its own expiry not passed), its
 * linked sign-in accounts, and the apps it authorized where the OAuth
 * provider is mounted, for the reminder. Throws when a read fails.
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
  return { apiKeys, signInAccounts, authorizedApps: apps };
}
