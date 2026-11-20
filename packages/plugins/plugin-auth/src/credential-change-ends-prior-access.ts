// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A credential change ends access issued before it.
 *
 * ## The rule
 *
 * Once an account's password changes, the following, issued for that account
 * before the change, no longer grant access after it — this list is the whole
 * of what the rule covers:
 *
 *  - an email-change link — the token `POST /change-email` mails (better-auth
 *    1.7.12, `routes/update-user.mjs`), any token carrying `updateTo` — minted
 *    before the change answers at `GET /verify-email` exactly what a token
 *    that was never issued answers;
 *  - a second-factor challenge a password sign-in opened before the change is
 *    ended at its verify door, which then answers what a challenge that does
 *    not exist answers;
 *  - a door that ends the account's sessions when it sets the password ends
 *    them again once the password is written: both reset doors, the user's
 *    own `/change-password` asked to end the other sessions (the session it
 *    installs is kept), and the one-step invitation door
 *    (`invitation-mailbox-proof.ts`, ahead of the session it opens);
 *  - a password sign-in is refused when the account's password changed while
 *    it ran: the session it opened is ended and it answers what a wrong
 *    password answers at that door.
 *
 * Access issued after the change is untouched.
 *
 * ## The one predicate, and the clock it reads
 *
 * {@link issuedBeforeCredentialChange} is the only comparison: something
 * issued strictly before the account's credential change is refused. The
 * change's moment is {@link readCredentialChangedAt}: the last time the
 * account's local credential row (`sys_account`, provider `credential`) was
 * written over, its `updated_at`. It is read through better-auth's internal
 * adapter (`findCredentialAccount`), the same row and the same seam the
 * vendor reads to check a password, so the clock needs no data engine: a
 * manager on the vendor's in-memory adapter reads it as well. Every door that
 * replaces a password writes that row — both reset doors, `/change-password`,
 * an administrator's `/admin/set-user-password`, the one-step invitation door
 * — whether or not it also stamps `sys_user.password_changed_at`. The row's
 * creation is the account's first password, not a change: a row written over
 * within {@link FIRST_CREDENTIAL_WINDOW_MS} of its creation reads as never
 * written over, and an account with no local credential has never changed
 * one. In either case nothing is refused.
 *
 * A token's issue time is the `iat` the vendor signs into it, whole seconds:
 * a token minted in the same second as the change, after it, is refused too.
 * Its owner asks for a new one.
 *
 * Each check fails closed: a clock or a record that cannot be read refuses
 * what it was asked to admit.
 *
 * ## Where it is wired
 *
 *  - `/verify-email`, the second-factor verify doors, and the password
 *    sign-in doors' first reading: the global before-hook
 *    (`auth-manager-before-hook.ts`).
 *  - The sessions a reset door or `/change-password` ends again, and the
 *    sign-in's second reading: the global after-hook
 *    (`auth-manager-after-hook.ts`), which runs ahead of every plugin's own
 *    after-hook, so a refused sign-in opens no second-factor challenge.
 *  - The one-step invitation door: in the door, before the session it opens.
 *
 * Each session ended here is ended through better-auth's internal adapter, so
 * every session-delete hook runs, and a reset door's records the reason a
 * reset records (`session-tombstone.ts`).
 */

/** The path of better-auth's email verification door. */
export const VERIFY_EMAIL_PATH = '/verify-email';

/** better-auth's second-factor verify doors (1.7.12 `plugins/two-factor`). */
export const TWO_FACTOR_VERIFY_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/two-factor/verify-backup-code',
]);

/** The name better-auth gives the second-factor challenge cookie. */
const TWO_FACTOR_COOKIE = 'two_factor';

/** The prefix of a challenge's attempt counter row, after which comes the challenge's identifier. */
const TWO_FACTOR_ATTEMPTS_PREFIX = '2fa-attempts-';

/**
 * The token the verify door is handed in place of an ended one: a value no
 * signer issued, so the vendor answers it as it answers any token it cannot
 * verify, through its own path.
 */
export const ENDED_EMAIL_CHANGE_TOKEN = 'ended-by-a-credential-change';

/** The context keys the before-hook leaves for the after-hook. */
const SIGN_IN_READING = '__osSignInCredentialReading';

/** The context key under which the before-hook leaves the account a reset door sets the password of. */
export const RESET_DOOR_SUBJECT = '__osResetDoorUserId';

/** better-auth's two reset doors (`resetCredentialPassword`), which end the sessions before the write. */
export const RESET_DOOR_PATHS: ReadonlySet<string> = new Set(['/reset-password', '/phone-number/reset-password']);

/**
 * The one comparison: `issuedAtMs` falls before the account's credential
 * change. Nothing is before a change that never happened; an issue time that
 * cannot be read is treated as before one that did.
 */
export function issuedBeforeCredentialChange(issuedAtMs: number, changedAtMs: number | undefined): boolean {
  if (changedAtMs === undefined) return false;
  if (!Number.isFinite(issuedAtMs)) return true;
  return issuedAtMs < changedAtMs;
}

function toMs(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const ms = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The seam the clock reads through: better-auth's internal adapter, whose
 * `findCredentialAccount` answers the account's local credential row (provider
 * `credential`, `accountId` the user's id) with its `createdAt` / `updatedAt`.
 */
export interface CredentialClockReader {
  findCredentialAccount(userId: string): Promise<{ createdAt?: unknown; updatedAt?: unknown } | null | undefined>;
}

/**
 * How long after its creation a credential row's own write still counts as
 * its creation: the row is written with a creation and an update stamp taken
 * separately, and the first password is not a change.
 */
export const FIRST_CREDENTIAL_WINDOW_MS = 1_000;

/**
 * The moment of the account's last credential change, in epoch ms, or
 * `undefined` when it has never had one. Throws when the record cannot be
 * read, so a caller refuses.
 */
export async function readCredentialChangedAt(reader: CredentialClockReader, userId: string): Promise<number | undefined> {
  const account = await reader.findCredentialAccount(userId);
  const created = toMs(account?.createdAt);
  const updated = toMs(account?.updatedAt);
  if (updated === undefined) return undefined;
  if (created !== undefined && updated - created <= FIRST_CREDENTIAL_WINDOW_MS) return undefined;
  return updated;
}

/**
 * Whether `issuedAt` falls before `userId`'s credential change, read through
 * the request's own internal adapter; a clock that cannot be read answers yes.
 */
async function issuedBeforeChangeOf(ctx: any, userId: string, issuedAtMs: number): Promise<boolean> {
  const reader: CredentialClockReader | undefined = ctx?.context?.internalAdapter;
  if (typeof reader?.findCredentialAccount !== 'function') return true;
  try {
    return issuedBeforeCredentialChange(issuedAtMs, await readCredentialChangedAt(reader, userId));
  } catch {
    return true;
  }
}

/**
 * `GET /verify-email`: an email-change token issued before the account's
 * credential change is replaced by {@link ENDED_EMAIL_CHANGE_TOKEN}, so the
 * door answers it what it answers a token never issued, its callback check
 * included. Answers the before-hook context that does so, or `undefined` to
 * leave the request as it came. A token that does not decode, or carries no
 * `updateTo`, is the vendor's to judge.
 */
export async function endEmailChangeTokenIssuedBeforeCredentialChange(
  ctx: any,
): Promise<{ context: { query: Record<string, unknown> } } | undefined> {
  if (ctx?.path !== VERIFY_EMAIL_PATH) return undefined;
  const token: unknown = ctx?.query?.token;
  if (typeof token !== 'string' || token.length === 0) return undefined;
  let claims: Record<string, unknown>;
  try {
    const { decodeJwt } = await import('jose');
    claims = decodeJwt(token) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof claims.updateTo !== 'string' || typeof claims.email !== 'string') return undefined;
  const ended = { context: { query: { ...(ctx.query ?? {}), token: ENDED_EMAIL_CHANGE_TOKEN } } };
  let userId: string | undefined;
  try {
    const found = await ctx.context.internalAdapter.findUserByEmail(claims.email.toLowerCase());
    const id: unknown = found?.user?.id;
    userId = typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return ended;
  }
  // No account at the address: the vendor's own refusal answers it.
  if (!userId) return undefined;
  const issuedAtMs = typeof claims.iat === 'number' ? claims.iat * 1000 : Number.NaN;
  return (await issuedBeforeChangeOf(ctx, userId, issuedAtMs)) ? ended : undefined;
}

/**
 * A second-factor verify door: the challenge the request's cookie names is
 * ended — its row and its attempt counter deleted — when it was opened before
 * the account's credential change, so the vendor's own check finds no
 * challenge. Throws when the challenge cannot be ended.
 */
export async function endTwoFactorChallengeIssuedBeforeCredentialChange(ctx: any): Promise<void> {
  if (!TWO_FACTOR_VERIFY_PATHS.has(ctx?.path)) return;
  const cookie = ctx?.context?.createAuthCookie?.(TWO_FACTOR_COOKIE);
  if (!cookie?.name || typeof ctx?.getSignedCookie !== 'function') return;
  const identifier: unknown = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (typeof identifier !== 'string' || identifier.length === 0) return;
  const internal = ctx.context.internalAdapter;
  const challenge = await internal.findVerificationValue(identifier);
  if (!challenge) return;
  const userId = typeof challenge.value === 'string' ? challenge.value : '';
  const issuedAtMs = toMs(challenge.createdAt) ?? Number.NaN;
  if (userId && !(await issuedBeforeChangeOf(ctx, userId, issuedAtMs))) return;
  await internal.deleteVerificationByIdentifier(identifier);
  await internal.deleteVerificationByIdentifier(`${TWO_FACTOR_ATTEMPTS_PREFIX}${identifier}`);
}

/** The local credential an account holds now, as better-auth reads it to check a password. */
async function readCredential(ctx: any, userId: string): Promise<string | undefined> {
  const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
  const password: unknown = account?.password;
  return typeof password === 'string' && password.length > 0 ? password : undefined;
}

/**
 * A password sign-in's first reading, before the vendor checks the password:
 * the account the request names and the credential it holds now, left on the
 * request for {@link refuseSignInAcrossCredentialChange}. `findAccountId`
 * answers the account the door's identifier names. A reading that cannot be
 * taken leaves none, which the second reading refuses.
 */
export async function noteSignInCredential(
  ctx: any,
  findAccountId: () => Promise<string | undefined>,
): Promise<void> {
  if (!ctx?.context) return;
  delete ctx.context[SIGN_IN_READING];
  try {
    const userId = await findAccountId();
    if (!userId) return;
    ctx.context[SIGN_IN_READING] = { userId, credential: await readCredential(ctx, userId) };
  } catch {
    // No reading: a sign-in it would have judged is refused after the fact.
  }
}

/**
 * A password sign-in's second reading, after the vendor opened its session:
 * when the account's credential is not the one the first reading saw (or
 * either reading is missing), the session is ended, the response carries no
 * session, and the refusal `refusal` builds is answered. Answers that refusal
 * for the caller to throw, or `undefined` when the sign-in stands. Inert for
 * a request that opened no session.
 */
export async function refuseSignInAcrossCredentialChange(
  ctx: any,
  refusal: () => Promise<Error>,
): Promise<Error | undefined> {
  const opened = ctx?.context?.newSession;
  const reading = ctx?.context?.[SIGN_IN_READING] as { userId: string; credential?: string } | undefined;
  if (ctx?.context) delete ctx.context[SIGN_IN_READING];
  const userId: unknown = opened?.user?.id;
  const token: unknown = opened?.session?.token;
  if (typeof userId !== 'string' || typeof token !== 'string') return undefined;
  let stands = false;
  if (reading && reading.userId === userId && reading.credential !== undefined) {
    try {
      stands = (await readCredential(ctx, userId)) === reading.credential;
    } catch {
      stands = false;
    }
  }
  if (stands) return undefined;
  await ctx.context.internalAdapter.deleteSession(token);
  ctx.context.setNewSession?.(null);
  const { deleteSessionCookie } = await import('better-auth/cookies');
  deleteSessionCookie(ctx, true);
  return refusal();
}

/**
 * End every session `userId` holds, except the one whose token is `keep`,
 * through better-auth's internal adapter (so every session-delete hook runs,
 * and the door's path decides what the ended row records).
 */
export async function endSessionsAfterCredentialWrite(
  internal: {
    listSessions(userId: string): Promise<Array<{ token?: unknown }>>;
    deleteSession(token: string): Promise<unknown>;
    deleteUserSessions(userId: string): Promise<unknown>;
  },
  userId: string,
  keep?: string,
): Promise<void> {
  if (!keep) {
    await internal.deleteUserSessions(userId);
    return;
  }
  for (const session of await internal.listSessions(userId)) {
    if (typeof session?.token === 'string' && session.token !== keep) await internal.deleteSession(session.token);
  }
}
