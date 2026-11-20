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
 *  - **every API key it owns** (`sys_api_key`): each unrevoked key is written
 *    `revoked: true`, the flag the key-admission seam
 *    (`resolveApiKeyAdmission`) filters on, so the very next call with the key
 *    resolves no principal. It records no `revoked_reason`, as a key its owner
 *    revokes records none (`api-key-restore-guard.ts`);
 *  - **every sign-in account linked to it other than its password**
 *    (`sys_account` rows of a provider other than `credential`: a social,
 *    generic OAuth or single-sign-on link), deleted through better-auth's
 *    internal adapter, so every account-delete hook runs. Nothing is recorded
 *    against linking again: the unlink record `implicit-account-linking.ts`
 *    writes is the user's own `/unlink-account`'s, so a provider may link
 *    again exactly as it could before it was ever linked;
 *  - **passkeys: none to end.** The plugin's `passkeys` flag is wired to no
 *    plugin and no passkey store is mounted (`invitation-mailbox-proof.ts`,
 *    `USER_KEYED_STORES`). A passkey store mounted later belongs in this list.
 *
 * The account's sessions are ended by the reset doors themselves, before and
 * again after the password write (`credential-change-ends-prior-access.ts`).
 *
 * A password CHANGE (`/change-password`, which proves the current password)
 * ends none of these. It reminds instead: when the account still holds an API
 * key or a linked sign-in account once its password has changed, the
 * account's address is sent `auth.password_changed_notice`, listing them,
 * through the mail service every auth notice goes through. The reminder is
 * best-effort, like the email-change notice: a reminder that cannot be read
 * or sent never fails the change.
 *
 * An administrator's forced reset (`/admin/set-user-password` with its
 * revocation switch on, the default) and the operator's reset
 * (`os user set-password`) end the same two things beside the sessions they
 * end, through `forced-reset-revocation.ts`. An administrator who turns the
 * switch off (`revokeSessionsAndKeys: false`) asks for a routine reset, and
 * nothing is ended: the switch is the reason that reset is not treated as a
 * self-service one. The one-step invitation door sets the password only of an
 * account that holds no sign-in and no standing grant (it answers `sign_in`
 * to any other), so it has nothing of this to end.
 *
 * ## Where, and how it fails
 *
 * In the global after-hook (`auth-manager-after-hook.ts`), on a reset door's
 * success, for the account the before-hook named (`RESET_DOOR_SUBJECT`): the
 * password is written by then, so a reset that does not complete ends
 * nothing. A read or a write that fails is not swallowed: the error reaches
 * the requester, and the next completed reset ends what remains. Without a
 * data engine the deployment holds no `sys_api_key` store, so there is no key
 * to end; the sign-in accounts are read through the vendor's adapter either
 * way.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/** The provider id of the account's local password row. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** How many keys one read asks for; the read repeats until none is left. */
const API_KEY_PAGE = 500;

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

/** What a completed reset ended: counts of rows really written. */
export interface ResetEndedAccess {
  apiKeys: number;
  signInAccounts: number;
}

/** What a password change leaves active, for its reminder. */
export interface AccessAPasswordChangeKeeps {
  /** Each unrevoked API key, by its name (its prefix when it has none). */
  apiKeys: string[];
  /** Each linked sign-in account, by its provider id. */
  signInAccounts: string[];
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

/** One page of the account's unrevoked API keys. */
async function unrevokedApiKeys(engine: ApiKeyStore, userId: string): Promise<Array<Record<string, unknown>>> {
  return rowsOf(
    await engine.find(
      SystemObjectName.API_KEY,
      { where: { user_id: userId, revoked: false }, fields: ['id', 'name', 'prefix'], limit: API_KEY_PAGE },
      { context: SYSTEM_CTX },
    ),
  );
}

/**
 * End what a completed self-service reset ends for `userId` (module header):
 * every linked sign-in account other than the password, and every API key.
 * Throws when a read or a write fails, so the requester is told.
 */
export async function endWhatTheAccountAddedBeforeAReset(
  stores: { accounts: SignInAccountStore; apiKeys: ApiKeyStore | undefined },
  userId: string,
): Promise<ResetEndedAccess> {
  const ended: ResetEndedAccess = { apiKeys: 0, signInAccounts: 0 };
  for (const account of await linkedSignInAccounts(stores.accounts, userId)) {
    await stores.accounts.deleteAccount(account.id);
    ended.signInAccounts += 1;
  }
  const engine = stores.apiKeys;
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

/**
 * What a password change leaves active for `userId`: its unrevoked API keys
 * and its linked sign-in accounts, for the reminder. Throws when a read fails.
 */
export async function accessAPasswordChangeKeeps(
  stores: { accounts: SignInAccountStore; apiKeys: ApiKeyStore | undefined },
  userId: string,
): Promise<AccessAPasswordChangeKeeps> {
  const signInAccounts = (await linkedSignInAccounts(stores.accounts, userId)).map((a) => a.providerId);
  const apiKeys: string[] = [];
  if (stores.apiKeys) {
    for (const row of await unrevokedApiKeys(stores.apiKeys, userId)) {
      const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : undefined;
      const prefix = typeof row.prefix === 'string' && row.prefix ? `${row.prefix}…` : undefined;
      apiKeys.push(name ?? prefix ?? String(row.id));
    }
  }
  return { apiKeys, signInAccounts };
}
