// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23772] The principal-session mint: a short-lived better-auth session for
 * the REQUESTING user's own principal, implementing the optional
 * `IAuthService.mintPrincipalSession` (`@objectstack/spec` contracts).
 *
 * Its consumer is an in-process service that has to act as the user through
 * a door that only accepts a session — the print service's headless browser,
 * which loads the console page the user may see, under the user's principal
 * and never a system one (#8346 ruling B′, M2). The credential may leave the
 * process (a remote browser endpoint), so every property below holds for the
 * credential itself, not for a caller that handles it carefully.
 *
 * ## What this module owns
 *
 *  1. **The refusals, all before anything is minted.** Human principals only
 *     (#22269 seat ruling OQ9 A). Asked in this order, each answered with
 *     `code` + `status` on a {@link PrincipalSessionMintRefusalError}:
 *       - no user on the context, a system context (`isSystem`), or a
 *         `principalKind` other than `human` (absent reads as `human`, as the
 *         spec declares it) → `PERMISSION_DENIED` / `403`;
 *       - a `ttlSeconds` outside 1..{@link PRINCIPAL_SESSION_MAX_TTL_SECONDS}
 *         → `VALIDATION_ERROR` / `400`;
 *       - a carried `authGate` → `403` with the posture's own code, the
 *         refusal `judgeHeldSession` gives every held session;
 *       - a user row that is missing, not a human (`isHumanUserRow`, the one
 *         predicate the audience gate and the dev seed read) or banned →
 *         `PERMISSION_DENIED` / `403`;
 *       - a posture computed NOW (`resolveUserAuthGates`, for the context's
 *         organization) → `403` with that posture's code, so a context built
 *         before the user was held cannot outrun the policy.
 *     An API key is not told apart here, deliberately: ADR-0090 D10 rules a
 *     key a credential of its owner, so a key-authenticated context IS the
 *     owner's human principal (`principalKind` absent or `human`).
 *
 *  2. **The TTL.** A fixed ceiling ({@link PRINCIPAL_SESSION_MAX_TTL_SECONDS}),
 *     refused above rather than clamped, so a caller that asks for more
 *     learns it at once. better-auth's `createSession` writes `expiresAt`
 *     AFTER the override spread, so the short life holds only with
 *     `overrideAll` — the impersonation endpoint's precedent.
 *
 *  3. **The non-extension, on every lane.** better-auth's `get-session`
 *     renews any session whose `expiresAt - expiresIn + updateAge` is past —
 *     which a 120-second session is from its first read — to
 *     `now + expiresIn` (7 days). Only a signed dont-remember cookie or
 *     `disableRefresh` stops that, and a bearer request carries neither, so a
 *     client-side defence would hold the cookie lane alone. The defence is
 *     therefore server-side, on the ONE write every renewal makes
 *     (`internalAdapter.updateSession`, through the `session.update.before`
 *     database hook, which runs under secondary storage too):
 *     {@link holdPrincipalSessionExpiry} pins a minted session's `expiresAt`
 *     to the value it was minted with. A minted session is recognised by its
 *     token, which carries {@link PRINCIPAL_SESSION_TOKEN_PREFIX} — set here,
 *     by the server, and stored on the row, so every node agrees.
 *
 *  4. **The revoke.** Bound to the one session minted, idempotent, and a
 *     plain `internalAdapter.deleteSession`: afterwards the token and the
 *     cookie resolve no session on either lane.
 *
 *  5. **The cookie.** Name and attributes are better-auth's own
 *     `authCookies.sessionToken`, the same derivation the plugin's session
 *     cookie gets from `advanced.cookiePrefix` / `useSecureCookies` — so the
 *     prefix and `__Secure-` follow the deployment with nothing restated.
 *
 * ⛔ Not impersonation (`admin-impersonate-endpoint.ts`): that mints a session
 * for a DIFFERENT principal and records `impersonatedBy`. This mints the
 * caller's own, with `impersonatedBy` unset.
 */

import { PRINCIPAL_SESSION_MAX_TTL_SECONDS } from '@objectstack/spec/contracts';
import type {
  PrincipalSession,
  PrincipalSessionCookie,
  PrincipalSessionMintOptions,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isHumanUserRow } from './audience-posture.js';
import { judgeHeldSession } from './platform-admin-gate.js';

/**
 * The brand every minted session token starts with. Never `osk_` (the API-key
 * prefix the transports route on) and free of `.`, which better-auth's bearer
 * hook reads as "already signed".
 */
export const PRINCIPAL_SESSION_TOKEN_PREFIX = 'psm_';

/** True when `token` is a minted principal session's token. */
export function isPrincipalSessionToken(token: unknown): boolean {
  return typeof token === 'string' && token.startsWith(PRINCIPAL_SESSION_TOKEN_PREFIX);
}

/**
 * A refusal of the mint, thrown before anything is minted. `code` and
 * `status` follow the ADR-0112 envelope, so a door that relays it answers
 * them unchanged.
 */
export class PrincipalSessionMintRefusalError extends Error {
  /** `PERMISSION_DENIED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, or a held posture's own code (`AuthGateCodeSchema`). */
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'PrincipalSessionMintRefusalError';
    this.code = code;
    this.status = status;
  }
}

const deny = (message: string) => new PrincipalSessionMintRefusalError('PERMISSION_DENIED', 403, message);

/** The posture refusal `judgeHeldSession` gives a held session, as a throw — or `null`. */
function heldRefusal(authGate: unknown): PrincipalSessionMintRefusalError | null {
  const held = judgeHeldSession({ authGate });
  if (!held) return null;
  const { code, message } = held.body.error;
  return new PrincipalSessionMintRefusalError(
    code,
    held.status,
    `A session cannot be minted for this user while an authentication policy holds them: ${message}`,
  );
}

/** The slice of better-auth's `$context` the mint uses. */
export interface PrincipalSessionAuthContext {
  secret: string;
  authCookies: {
    sessionToken: {
      name: string;
      attributes: { path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; domain?: string };
    };
  };
  internalAdapter: {
    findUserById(userId: string): Promise<Record<string, unknown> | null>;
    createSession(
      userId: string,
      dontRememberMe: boolean,
      override: Record<string, unknown>,
      overrideAll: boolean,
    ): Promise<{ token: string; expiresAt: Date | string } | null>;
    deleteSession(token: string): Promise<void>;
  };
}

/** What the mint needs from its host, `AuthManager`. */
export interface PrincipalSessionMintDeps {
  authContext(): Promise<PrincipalSessionAuthContext>;
  resolveUserAuthGates(userId: string, options: { organizationId?: string }): Promise<readonly unknown[]>;
}

/** The refusals that need no read, in order: the principal, then the TTL. */
function refuseUpFront(context: ExecutionContext | undefined, options: PrincipalSessionMintOptions | undefined): number {
  const userId = context?.userId;
  if (typeof userId !== 'string' || !userId) {
    throw deny('A principal session is minted only for a signed-in user, and this context carries no user.');
  }
  if (context!.isSystem === true) {
    throw deny('A principal session is never minted for a system context: it acts as the requesting user only.');
  }
  const kind = context!.principalKind ?? 'human';
  if (kind !== 'human') {
    throw deny(`A principal session is minted for human principals only, and this principal is '${kind}'.`);
  }

  const ttl = options?.ttlSeconds ?? PRINCIPAL_SESSION_MAX_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > PRINCIPAL_SESSION_MAX_TTL_SECONDS) {
    throw new PrincipalSessionMintRefusalError(
      'VALIDATION_ERROR',
      400,
      `ttlSeconds must be a whole number of seconds from 1 to ${PRINCIPAL_SESSION_MAX_TTL_SECONDS}; got ${String(options?.ttlSeconds)}.`,
    );
  }

  const carried = heldRefusal(context!.authGate);
  if (carried) throw carried;
  return ttl;
}

function isBanned(user: Record<string, unknown>): boolean {
  if (user.banned !== true && user.banned !== 1) return false;
  const until = user.banExpires ?? user.ban_expires;
  if (until == null || until === '') return true;
  const ms = new Date(until as string | Date).getTime();
  return !Number.isFinite(ms) || ms > Date.now();
}

/** better-call's signed-cookie value (`encodeURIComponent(value + '.' + HMAC-SHA256)`), what `setSignedCookie` writes. */
async function signedValue(token: string, secret: string): Promise<string> {
  const { makeSignature } = await import('better-auth/crypto');
  return encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
}

function cookieOf(ctx: PrincipalSessionAuthContext, value: string): PrincipalSessionCookie {
  const { name, attributes } = ctx.authCookies.sessionToken;
  const sameSite = typeof attributes.sameSite === 'string' ? attributes.sameSite.toLowerCase() : undefined;
  return {
    name,
    value,
    path: attributes.path || '/',
    httpOnly: attributes.httpOnly !== false,
    secure: attributes.secure === true,
    ...(sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none' ? { sameSite } : {}),
    ...(attributes.domain ? { domain: attributes.domain } : {}),
  };
}

/**
 * Mint a short-lived session for `context`'s own user (see the module header
 * for the refusals, the TTL, the non-extension and the revoke).
 */
export async function mintPrincipalSession(
  deps: PrincipalSessionMintDeps,
  context: ExecutionContext,
  options?: PrincipalSessionMintOptions,
): Promise<PrincipalSession> {
  const ttl = refuseUpFront(context, options);
  const userId = context.userId as string;
  const organizationId = typeof context.tenantId === 'string' && context.tenantId ? context.tenantId : undefined;

  const ctx = await deps.authContext();
  const user = await ctx.internalAdapter.findUserById(userId);
  if (!user) throw deny('A principal session cannot be minted: the requesting user does not exist.');
  if (!isHumanUserRow(user)) throw deny('A principal session is minted for human users only, and this user is a system identity.');
  if (isBanned(user)) throw deny('A principal session cannot be minted for a banned user.');

  const live = await deps.resolveUserAuthGates(userId, organizationId ? { organizationId } : {});
  const held = heldRefusal(live[0]);
  if (held) throw held;

  const { generateRandomString } = await import('better-auth/crypto');
  const token = `${PRINCIPAL_SESSION_TOKEN_PREFIX}${generateRandomString(32, 'a-z', 'A-Z', '0-9')}`;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const session = await ctx.internalAdapter.createSession(
    userId,
    false,
    { token, expiresAt, ...(organizationId ? { activeOrganizationId: organizationId } : {}) },
    true,
  );
  if (!session || session.token !== token) {
    if (session?.token) await ctx.internalAdapter.deleteSession(session.token);
    throw new PrincipalSessionMintRefusalError(
      'INTERNAL_ERROR',
      500,
      'A principal session could not be minted: the session store did not keep the minted token.',
    );
  }

  const value = await signedValue(token, ctx.secret);
  let revoked = false;
  return {
    token: value,
    cookie: cookieOf(ctx, value),
    expiresAt: new Date(session.expiresAt).toISOString(),
    revoke: async () => {
      if (revoked) return;
      await ctx.internalAdapter.deleteSession(token);
      revoked = true;
    },
  };
}

const toMs = (v: unknown): number => (v instanceof Date ? v.getTime() : new Date(v as string).getTime());

/**
 * The `session.update.before` guard: when better-auth renews a minted
 * session, pin `expiresAt` back to the value the session holds. `endpointCtx`
 * is the hook's second argument, the endpoint context whose
 * `context.session` is the session `get-session` read and is renewing.
 * Returns the update to write instead, or `undefined` to leave it alone (any
 * other session, any update that does not raise `expiresAt`, a revocation
 * that lowers it).
 */
export function holdPrincipalSessionExpiry(
  update: Record<string, unknown> | undefined,
  endpointCtx: unknown,
): Record<string, unknown> | undefined {
  if (!update || update.expiresAt == null) return undefined;
  const target = (endpointCtx as { context?: { session?: { session?: { token?: unknown; expiresAt?: unknown } } } })
    ?.context?.session?.session;
  if (!isPrincipalSessionToken(target?.token)) return undefined;
  const ceiling = toMs(target!.expiresAt);
  if (!Number.isFinite(ceiling) || toMs(update.expiresAt) <= ceiling) return undefined;
  return { ...update, expiresAt: new Date(ceiling) };
}
