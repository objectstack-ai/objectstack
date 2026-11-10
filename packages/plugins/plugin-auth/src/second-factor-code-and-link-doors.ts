// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The second factor at the code and link doors.
 *
 * ## The rule
 *
 * An account with an enrolled second factor is signed in by no one-time code
 * or sign-in link alone; a code or link door asks for the second factor, as
 * password sign-in does. An account with no enrolled factor signs in at these
 * doors exactly as before.
 *
 * ## How it is applied
 *
 * The challenge is the two-factor plugin's own: the same after-hook handler
 * password sign-in runs, reused by reference (never copied), so the answer is
 * the one password sign-in gives — `{ twoFactorRedirect, twoFactorMethods }`,
 * no session, and the pending two-factor cookie — and the trust-device cookie,
 * TOTP, OTP and backup-code completions behave exactly as they do there.
 *
 * The doors, by path:
 *
 *  - `/phone-number/verify` — the SMS one-time code;
 *  - `/magic-link/verify` — the emailed sign-in link, on both its JSON and its
 *    `callbackURL` redirect lane;
 *  - `/verify-email` — the emailed verification link, whenever it signs the
 *    caller in.
 *
 * A door call that issues no new session is not a sign-in and is left alone:
 * `/phone-number/verify` with `disableSession: true` or `updatePhoneNumber:
 * true`, and `/verify-email` for a caller who already holds the session it
 * answers with.
 *
 * ## Fail closed on vendor drift
 *
 * {@link requireSecondFactorAtCodeAndLinkDoors} throws when the plugin it is
 * handed exposes no after-hook that accepts password sign-in
 * (`/sign-in/email`): with no challenge to reuse, a build that went ahead
 * would let these doors sign enrolled accounts in on a code or link alone.
 * The failure is the build's, at boot, never a silently open door.
 */

/** The code and link doors that ask an enrolled account for its second factor. */
export const SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS: readonly string[] = Object.freeze([
  '/phone-number/verify',
  '/magic-link/verify',
  '/verify-email',
]);

/** The password door whose challenge the code and link doors reuse. */
export const PASSWORD_SIGN_IN_PATH = '/sign-in/email';

/** A better-auth hook entry, as far as this module reads it. */
interface AfterHookEntry {
  matcher: (context: any) => boolean;
  handler: (...args: any[]) => unknown;
}

/** A plugin object, as far as this module reads and extends it. */
interface PluginWithAfterHooks {
  hooks?: { after?: AfterHookEntry[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** The token of a session-shaped value, or `undefined`. */
function sessionTokenOf(value: unknown): string | undefined {
  const token = (value as { session?: { token?: unknown } } | null | undefined)?.session?.token;
  return typeof token === 'string' && token !== '' ? token : undefined;
}

/**
 * Whether this request is a code or link door that has just issued a new
 * session — the moment the second factor is asked for.
 *
 * Read after the endpoint has answered (after-hooks run then): the session it
 * issued is `context.newSession`, and the session the caller arrived holding,
 * if the endpoint read one, is `context.session`. Answering with the session
 * the caller already holds signs nobody in; a session held for another
 * account never stands in for the second factor, and an issued session whose
 * token cannot be read counts as a sign-in (fail closed).
 */
export function isCodeOrLinkDoorSignIn(hookContext: any): boolean {
  if (!SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS.includes(hookContext?.path)) return false;
  const newSession = hookContext?.context?.newSession;
  if (!newSession) return false;
  const issued = sessionTokenOf(newSession);
  // Fail closed: an issued session whose token cannot be read is still a
  // sign-in, so the challenge applies.
  if (!issued) return true;
  return sessionTokenOf(hookContext?.context?.session) !== issued;
}

/** Whether `entry` is a hook whose matcher accepts password sign-in. */
function acceptsPasswordSignIn(entry: unknown): entry is AfterHookEntry {
  const candidate = entry as Partial<AfterHookEntry> | null | undefined;
  if (typeof candidate?.matcher !== 'function' || typeof candidate?.handler !== 'function') return false;
  try {
    return candidate.matcher({ path: PASSWORD_SIGN_IN_PATH }) === true;
  } catch {
    return false;
  }
}

/**
 * Extend the two-factor plugin's sign-in challenge to the code and link doors,
 * in place on the plugin object `twoFactor(...)` returned, and hand that same
 * object back.
 *
 * Appends ONE after-hook entry whose handler is the password door's own
 * challenge handler and whose matcher is {@link isCodeOrLinkDoorSignIn}.
 *
 * @throws Error when the plugin exposes no after-hook that accepts
 *   `/sign-in/email` — fail closed rather than build these doors without the
 *   second factor.
 */
export function requireSecondFactorAtCodeAndLinkDoors<T extends object>(plugin: T): T {
  const target = plugin as unknown as PluginWithAfterHooks;
  const after = target?.hooks?.after;
  const passwordChallenge = Array.isArray(after) ? after.find(acceptsPasswordSignIn) : undefined;
  if (!passwordChallenge) {
    throw new Error(
      '[AuthManager] The two-factor plugin exposes no after-hook that accepts password sign-in ' +
        `(${PASSWORD_SIGN_IN_PATH}), so the second-factor challenge cannot be extended to the code and ` +
        `link doors (${SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS.join(', ')}). Refusing to build the auth ` +
        'instance: an account with an enrolled second factor must not be signed in by a one-time code ' +
        'or sign-in link alone. Update second-factor-code-and-link-doors.ts for the installed ' +
        'better-auth two-factor plugin.',
    );
  }
  target.hooks!.after = [
    ...after!,
    { matcher: isCodeOrLinkDoorSignIn, handler: passwordChallenge.handler },
  ];
  return plugin;
}
