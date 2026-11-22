// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An account disabled or removed by any door keeps nothing running in its name.
 *
 * ## The rule
 *
 * A platform administrator's ban (`/admin/ban-user`), the organization's
 * directory deactivating or deleting the person (SCIM `active: false` or
 * `DELETE /Users/{id}`), and an administrator's delete (`/admin/remove-user`)
 * each end what a password reset ends of the account's registrations, through
 * the reset's own arm (`endWhatTheAccountRegistered`,
 * `password-reset-ends-added-access.ts`):
 *
 *  - every OAuth application the account registered is written `disabled`, as
 *    the platform administrator's Disable action writes it, so it is issued no
 *    token and every token it holds is refused. A platform administrator may
 *    enable it again;
 *  - every SCIM provisioning credential the account minted is revoked, one-way,
 *    and each revoke writes the `scim_credential_revoked` audit row a reset
 *    writes.
 *
 * The single sign-on providers the account registered are kept, as a reset
 * keeps them. An unban or a re-activation restores none of these: an
 * application is enabled again by a platform administrator, and a revoked
 * credential is replaced by a newly minted one.
 *
 * The AI service accounts the person is accountable for are the other half of
 * the rule (`service-account-owner-leaves.ts`): a ban and a directory
 * deactivation suspend them; a delete ends the person's memberships, which
 * suspends them as an owner's leaving does.
 *
 * Known trade: when the administrator who minted a connection's credential is
 * banned, deactivated or removed, the credential is revoked and provisioning
 * through that connection pauses until another administrator mints a new one
 * (rotate the credential first to avoid the pause).
 *
 * ## Where each door runs it, and how it fails
 *
 *  - **Ban** (`admin-ban-endpoints.ts`): after the ban write, its revokes
 *    recorded against the administrator. The ban has landed, so a failure does
 *    not undo it: the answer says what was ended and that it is not complete,
 *    as the administrator's forced reset answers, and banning again retries.
 *  - **Directory** (`AuthManager#reconcileScimUserLifecycle`): on every
 *    inactive call, after the ban, its revokes recorded against the
 *    connection's service principal. It never fails the deprovision: a revoked
 *    credential is reported in one `error` line naming it and the remedy
 *    ({@link directoryRevokedCredentialsMessage}), an arm that did not finish
 *    in one more ({@link directoryRegistrationsIncompleteMessage}), and the next
 *    inactive write retries it.
 *  - **Delete** (better-auth's `user.delete.before` database hook,
 *    {@link endRegistrationsBeforeAccountDelete}): after the vendor authorized
 *    the delete, inside its unit of work, before the row is deleted, its
 *    revokes recorded against the administrator. A row deleted is the last
 *    moment the account's registrations can be found by their owner, so an arm
 *    that does not finish refuses the delete, and its unit of work rolls back.
 *    The delete answers what it ended ({@link runWithRemovalTally}).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { endWhatTheAccountRegistered, type CredentialRevokeTrail, type EndedRegistrations } from './password-reset-ends-added-access.js';
import { registrationStoreOf, type ForcedResetRevocationEngine } from './forced-reset-revocation.js';

/** The slice of the data engine the account's registrations are read and written through. */
export type RemovedAccountEngine = ForcedResetRevocationEngine & {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
};

/** What one pass over a removed account's registrations ended, each named as it was ended. */
export interface RemovedAccountRegistrations extends EndedRegistrations {
  /** The first read or write that failed, when one did: what it ended before that is named all the same. */
  error?: string;
}

/**
 * End every registration of `userId` a password reset ends (module header):
 * its OAuth applications disabled, its SCIM credentials revoked, each revoke
 * recorded against `trail`. Never throws: a read or a write that failed is the
 * outcome's `error`. No engine, nothing to end.
 */
export async function endRegistrationsOfARemovedAccount(
  engine: RemovedAccountEngine | undefined,
  userId: string,
  trail?: CredentialRevokeTrail,
): Promise<RemovedAccountRegistrations> {
  const ended: RemovedAccountRegistrations = { ownedApps: [], scimCredentials: [] };
  if (!engine || typeof engine.find !== 'function') return ended;
  try {
    await endWhatTheAccountRegistered(registrationStoreOf(engine), userId, ended, trail);
  } catch (error) {
    ended.error = (error as Error)?.message ?? String(error);
  }
  return ended;
}

/**
 * The one `error` line for a directory deactivation that revoked SCIM
 * credentials the person minted: provisioning through each such connection
 * pauses, the identity provider's next request is refused, and nothing else
 * looks wrong.
 */
export function directoryRevokedCredentialsMessage(userId: string, credentials: readonly string[]): string {
  return `[auth] the directory deactivated user '${userId}', who minted SCIM provisioning credential(s) `
    + `${credentials.map((c) => `'${c}'`).join(', ')}; they are revoked, so provisioning through those `
    + 'connection(s) pauses from the identity provider\'s next request, which is refused. Remedy: another '
    + 'platform administrator mints a new credential for each connection and gives it to the identity provider; '
    + 'rotate a connection\'s credential to another administrator before removing the one who minted it.';
}

/** The one `error` line for a directory deactivation whose registrations could not all be ended. */
export function directoryRegistrationsIncompleteMessage(userId: string, outcome: RemovedAccountRegistrations): string {
  return `[auth] ending the registrations of user '${userId}' INCOMPLETE — the directory deactivated the user, but `
    + `${outcome.ownedApps.length} OAuth application(s) were disabled and ${outcome.scimCredentials.length} SCIM `
    + `credential(s) revoked before a read or a write failed (${outcome.error ?? 'unknown error'}). The deprovision `
    + 'succeeded and the user is disabled, but an application or a credential left in place keeps working in their '
    + 'name. Remedy: disable each OAuth application whose user_id is this user and revoke each SCIM credential it '
    + 'minted by hand; the next SCIM write that leaves the user inactive retries it.';
}

// ── The delete's answer ──────────────────────────────────────────────────────

/** What an administrator's delete ended, answered as the forced reset answers its `revoked`. */
export interface RemovalEnded {
  /** The OAuth applications the account registered, now disabled. */
  ownedApps: number;
  /** The SCIM connection credentials the account minted, now revoked. */
  scimCredentials: number;
}

interface RemovalTally {
  ended?: RemovalEnded;
}

const removalTally = new AsyncLocalStorage<RemovalTally>();

/**
 * Run an administrator's delete (`/admin/remove-user`) with a tally the
 * delete's database hook writes what it ended into, and hand both back: the
 * request seam adds it to the delete's answer. A delete whose hook did not run
 * (refused before it, or a user without the row) tallies nothing.
 */
export async function runWithRemovalTally<T>(run: () => Promise<T>): Promise<{ value: T; ended?: RemovalEnded }> {
  const tally: RemovalTally = {};
  const value = await removalTally.run(tally, run);
  return { value, ...(tally.ended ? { ended: tally.ended } : {}) };
}

/** The better-auth endpoint path of an administrator's delete. */
export const ADMIN_REMOVE_USER_PATH = '/admin/remove-user';

/**
 * The delete's answer with what it ended: a delete that succeeded (`2xx`,
 * a JSON object) and whose hook ran carries `revoked`, counts only; any other
 * answer is handed back as it is.
 */
export async function answerRemovalEnded(tallied: { value: Response; ended?: RemovalEnded }): Promise<Response> {
  const { value: response, ended } = tallied;
  if (!ended || response.status < 200 || response.status >= 300) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...(body as Record<string, unknown>), revoked: ended }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The refusal a delete whose registrations could not be ended is answered with; nothing was deleted. */
export class RemovedAccountRegistrationsNotEnded extends Error {
  constructor(readonly userId: string, readonly outcome: RemovedAccountRegistrations) {
    super(
      `The OAuth applications and SCIM credentials of user '${userId}' could not all be ended, so the user was not `
        + `removed and nothing was changed (${outcome.error ?? 'unknown error'}). Try again.`,
    );
    this.name = 'RemovedAccountRegistrationsNotEnded';
  }
}

/**
 * The delete's arm, from better-auth's `user.delete.before` hook: end the
 * account's registrations before its row is deleted, inside the delete's unit
 * of work, each revoke recorded against `actorId` (the administrator) when one
 * is known, and write what was ended into the tally {@link runWithRemovalTally}
 * opened. Throws {@link RemovedAccountRegistrationsNotEnded} when a read or a
 * write failed, so the delete is refused and rolls back.
 */
export async function endRegistrationsBeforeAccountDelete(
  engine: RemovedAccountEngine | undefined,
  userId: string,
  opts: { actorId?: string; warn?: (message: string) => void } = {},
): Promise<RemovalEnded> {
  const trail: CredentialRevokeTrail | undefined = opts.actorId
    ? { actorId: opts.actorId, act: 'removing an account', ...(opts.warn ? { warn: opts.warn } : {}) }
    : undefined;
  const outcome = await endRegistrationsOfARemovedAccount(engine, userId, trail);
  if (outcome.error !== undefined) throw new RemovedAccountRegistrationsNotEnded(userId, outcome);
  const ended: RemovalEnded = { ownedApps: outcome.ownedApps.length, scimCredentials: outcome.scimCredentials.length };
  const tally = removalTally.getStore();
  if (tally) tally.ended = ended;
  return ended;
}
