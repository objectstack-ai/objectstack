// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A TOTP code is accepted once.
 *
 * ## The rule
 *
 * A TOTP code the two-factor plugin accepts is remembered for its user, for as
 * long as the verifier's window could still accept it, and every later
 * presentation of it is refused: on another sign-in challenge, from another
 * client, on another node, and on the session lane (RFC 6238 §5.2). A code
 * whose time step is at or before the last step accepted for that user and
 * secret is refused too. The refusal is the answer a wrong code gets.
 *
 * ## The door
 *
 * `/two-factor/verify-totp` is the one route that takes a TOTP code. It is the
 * sign-in challenge (no session, the pending two-factor cookie), the enrolment
 * confirmation (a session, an unconfirmed factor) and the session-lane check
 * (a session, a confirmed factor). `/two-factor/enable`, `/two-factor/disable`
 * and `/two-factor/get-totp-uri` take a password; `/two-factor/verify-otp`
 * and `/two-factor/verify-backup-code` take codes that are not TOTP codes. The
 * route ledger (`auth-route-ledger.ts`) pins the published route set, so a new
 * code-taking route is a reviewed ledger change.
 *
 * ## How it is applied
 *
 * One before-hook, appended IN PLACE to the two-factor plugin object, matched
 * on that path. Before the vendor verifies, it:
 *
 *  1. resolves the user the vendor will verify for, in the vendor's own order:
 *     the session first, then the pending challenge cookie's verification row;
 *  2. finds the time step the presented code belongs to, inside the window the
 *     vendor's verifier accepts (the newest matching step wins);
 *  3. reserves that step for the user and the secret in `sys_verification`
 *     through better-auth's own single-use reservation
 *     (`internalAdapter.reserveVerificationValue`), whose row id is derived
 *     from the identifier, so a second reservation of the same step fails at
 *     the store's primary key — across clients, processes and nodes, and for
 *     two presentations that arrive together;
 *  4. reserves every earlier step of the window as well, so a code from a step
 *     at or before an accepted one finds its step already held.
 *
 * A step that is already held turns the request into a wrong-code request: the
 * hook hands the vendor a code no generated TOTP equals, so the per-challenge
 * attempt budget, the account lockout counter and the answer are exactly the
 * ones a wrong code gets. A code that matches no step of the window is left to
 * the vendor, which refuses it on its own.
 *
 * A reservation is keyed by the user AND a digest of the secret, because a
 * code is a function of the secret and its step: a re-enrolled secret's codes
 * are new codes, and its first code may share a step with the old secret's
 * last one. A row lives one period past the last moment the vendor's window
 * could accept its step, a margin for clocks that differ between nodes.
 *
 * A store failure while reserving fails the request (the error propagates):
 * a code the store could not record as spent is not accepted.
 *
 * ## Fail closed on vendor drift
 *
 * {@link acceptEachTotpCodeOnce} throws when the two-factor plugin it is handed
 * serves routes but none at `/two-factor/verify-totp`: a build that went ahead
 * would accept TOTP codes at a door this hook does not match. The failure is
 * the build's, at boot. A plugin object that serves no route at all takes no
 * code, and is handed back as it is.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** The route that takes a TOTP code. */
export const TOTP_VERIFY_PATH = '/two-factor/verify-totp';

/** The id better-auth's two-factor plugin declares. */
export const TWO_FACTOR_PLUGIN_ID = 'two-factor';

/**
 * The steps on either side of the current one the vendor's verifier accepts:
 * `/two-factor/verify-totp` calls `createOTP(...).verify(code)` with no
 * options, and `verifyTOTP` defaults `window` to 1 (`@better-auth/utils/otp`).
 */
export const TOTP_ACCEPTANCE_WINDOW = 1;

/**
 * The pending sign-in challenge cookie the vendor sets (`TWO_FACTOR_COOKIE_NAME`
 * in better-auth's two-factor plugin, not exported by the package). The door
 * pins in `totp-code-single-use.test.ts` drive the challenge lane, so a renamed
 * cookie turns them red rather than leaving that lane unguarded.
 */
const TWO_FACTOR_CHALLENGE_COOKIE = 'two_factor';

/** The vendor's TOTP defaults (`totp2fa`: `digits || 6`, `period || 30`). */
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;

/**
 * A code no generated TOTP equals: every generated code has exactly `digits`
 * digits, and the vendor's comparison refuses a length mismatch first.
 */
export const NEVER_ACCEPTED_TOTP_CODE = '-';

/**
 * The request-body field `/two-factor/verify-totp` reads the TOTP code from
 * (its body schema: `{ code, trustDevice? }`). Named, and written as a computed
 * key below, because it is a one-time code, never an error code.
 */
const TOTP_CODE_BODY_FIELD = 'code';

/** The identifier prefix of a spent-step reservation row in `sys_verification`. */
export const SPENT_TOTP_STEP_IDENTIFIER_PREFIX = 'totp-step:';

/** A better-auth hook entry, as far as this module writes it. */
interface HookEntry {
  matcher: (context: any) => boolean;
  handler: (...args: any[]) => unknown;
}

/** A plugin object, as far as this module reads and extends it. */
interface TwoFactorPluginShape {
  id?: unknown;
  endpoints?: Record<string, { path?: unknown } | undefined>;
  hooks?: { before?: HookEntry[]; after?: HookEntry[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** RFC 4226 HOTP over the secret's UTF-8 bytes, as the vendor computes it. */
export function hotp(secret: string, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The newest time step in `[current - window, current + window]` whose code
 * equals `code`, or `undefined`. Every step of the window is compared, in
 * constant time per comparison, whichever matches.
 */
export function matchedTotpStep(
  secret: string,
  code: string,
  options: { current: number; window: number; digits: number },
): number | undefined {
  const presented = Buffer.from(code, 'utf8');
  let matched: number | undefined;
  for (let step = options.current - options.window; step <= options.current + options.window; step++) {
    const expected = Buffer.from(hotp(secret, step, options.digits), 'utf8');
    const equal = presented.length === expected.length && timingSafeEqual(presented, expected);
    if (equal) matched = step;
  }
  return matched;
}

/**
 * The reservation identifier of one time step of one user's secret. The secret
 * enters only as a truncated SHA-256 digest, so the row names which secret
 * spent the step without carrying anything that verifies a code.
 */
export function spentTotpStepIdentifier(userId: string, secret: string, step: number): string {
  const digest = createHash('sha256').update(`${SPENT_TOTP_STEP_IDENTIFIER_PREFIX}${secret}`).digest('base64url');
  return `${SPENT_TOTP_STEP_IDENTIFIER_PREFIX}${userId}:${digest.slice(0, 22)}:${step}`;
}

/** The user the vendor will verify the code for, or `undefined` when it will refuse before verifying. */
async function verifyingUserId(ctx: any): Promise<string | undefined> {
  const { getSessionFromCtx } = await import('better-auth/api');
  const session: any = await getSessionFromCtx(ctx).catch(() => null);
  const sessionUserId = session?.user?.id;
  if (typeof sessionUserId === 'string' && sessionUserId !== '') return sessionUserId;

  const cookieName = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE_COOKIE).name;
  const challenge = await ctx.getSignedCookie(cookieName, ctx.context.secret);
  if (typeof challenge !== 'string' || challenge === '') return undefined;
  const row: any = await ctx.context.internalAdapter.findVerificationValue(challenge);
  const challengedUserId = row?.value;
  return typeof challengedUserId === 'string' && challengedUserId !== '' ? challengedUserId : undefined;
}

/** The plaintext TOTP secret enrolled for `userId`, or `undefined` when the vendor will refuse before verifying. */
async function enrolledSecret(ctx: any, userId: string): Promise<string | undefined> {
  const row: any = await ctx.context.adapter.findOne({
    model: 'twoFactor',
    where: [{ field: 'userId', value: userId }],
  });
  if (typeof row?.secret !== 'string' || row.secret === '') return undefined;
  const { symmetricDecrypt } = await import('better-auth/crypto');
  try {
    return await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
  } catch {
    // The vendor decrypts the same column with the same key and fails the
    // request the same way; it stays the owner of that answer.
    return undefined;
  }
}

/**
 * The before-hook body. Answers nothing when the code may go on to the vendor
 * as presented, and `{ context: { body } }` carrying a code that never verifies
 * when its step is already spent.
 */
export async function refuseSpentTotpStep(ctx: any): Promise<{ context: { body: Record<string, unknown> } } | void> {
  const code = ctx?.body?.[TOTP_CODE_BODY_FIELD];
  if (typeof code !== 'string' || code === '') return;

  const totpOptions = ctx.context.getPlugin?.(TWO_FACTOR_PLUGIN_ID)?.options?.totpOptions;
  const period: number = totpOptions?.period || DEFAULT_PERIOD_SECONDS;
  const digits: number = totpOptions?.digits || DEFAULT_DIGITS;
  if (code.length !== digits) return;

  const userId = await verifyingUserId(ctx);
  if (!userId) return;
  const secret = await enrolledSecret(ctx, userId);
  if (!secret) return;

  const window = TOTP_ACCEPTANCE_WINDOW;
  const current = Math.floor(Date.now() / (period * 1000));
  const step = matchedTotpStep(secret, code, { current, window, digits });
  if (step === undefined) return;

  const reserve = (spent: number): Promise<boolean> =>
    ctx.context.internalAdapter.reserveVerificationValue({
      identifier: spentTotpStepIdentifier(userId, secret, spent),
      value: userId,
      expiresAt: new Date((spent + window + 2) * period * 1000),
    });

  if (!(await reserve(step))) {
    return { context: { body: { ...ctx.body, [TOTP_CODE_BODY_FIELD]: NEVER_ACCEPTED_TOTP_CODE } } };
  }
  for (let earlier = current - window; earlier < step; earlier++) await reserve(earlier);
}

/** Whether `endpoint` is served at the TOTP door. */
function servesTotpDoor(endpoint: unknown): boolean {
  return (endpoint as { path?: unknown } | null | undefined)?.path === TOTP_VERIFY_PATH;
}

const extended = new WeakSet<object>();

/**
 * Make every TOTP code the two-factor plugin accepts single-use, in place on
 * the plugin object in `plugins`, and hand the same list back. A list with no
 * two-factor plugin is handed back untouched.
 *
 * @throws Error when the two-factor plugin serves routes but none at
 *   `/two-factor/verify-totp`: fail closed rather than build a TOTP door this
 *   hook does not match.
 */
export async function acceptEachTotpCodeOnce<T extends unknown[]>(plugins: T): Promise<T> {
  const target = plugins.find(
    (plugin) => (plugin as TwoFactorPluginShape | null | undefined)?.id === TWO_FACTOR_PLUGIN_ID,
  ) as TwoFactorPluginShape | undefined;
  if (!target || extended.has(target)) return plugins;
  // better-auth mounts a plugin's routes from `endpoints`: a plugin that serves
  // none takes no code anywhere, so there is no door to guard. One that serves
  // routes, none of them this door, has moved the door.
  const endpoints = Object.values(target.endpoints ?? {});
  if (endpoints.length === 0) return plugins;
  if (!endpoints.some(servesTotpDoor)) {
    throw new Error(
      `[AuthManager] The two-factor plugin serves routes but none at ${TOTP_VERIFY_PATH}, so its TOTP codes ` +
        'cannot be made single-use where they are accepted. Refusing to build the auth instance: a TOTP ' +
        'code must be refused on any use after the first. Update totp-code-single-use.ts for the ' +
        'installed better-auth two-factor plugin.',
    );
  }
  const { createAuthMiddleware } = await import('better-auth/api');
  const entry: HookEntry = {
    matcher: (context: any) => context?.path === TOTP_VERIFY_PATH,
    handler: createAuthMiddleware(async (ctx: any) => refuseSpentTotpStep(ctx)),
  };
  target.hooks = { ...target.hooks, before: [...(target.hooks?.before ?? []), entry] };
  extended.add(target);
  return plugins;
}
