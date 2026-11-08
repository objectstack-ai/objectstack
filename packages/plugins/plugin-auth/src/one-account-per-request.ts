// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An auth request is judged and executed as one account.
 *
 * ## The rule
 *
 * A request may carry two credentials at once: the session cookie and an
 * `Authorization: Bearer` session token. When BOTH name a signed-in account
 * and the two accounts are different, the request is refused before anything
 * runs — before every ObjectStack gate and before the endpoint — with
 * `401 CREDENTIALS_NAME_DIFFERENT_ACCOUNTS`, and nothing is read or written for
 * either account.
 *
 * Nothing else trips it:
 *
 *  - one credential alone — the cookie lane and the bearer lane are untouched;
 *  - two credentials that name the SAME account, two sessions of one user
 *    included (the Console sends both on every request, normally for one
 *    session);
 *  - a credential that names no signed-in account: no session carries its
 *    token, the session has expired, or its user is gone. Such a request goes
 *    on exactly as it would have without this rule.
 *
 * ## How a credential is read here
 *
 * By its token alone: the cookie value, and the bearer value, each without
 * whatever follows its first `.` (the signature better-auth appends), then
 * looked up through better-auth's own session read
 * (`internalAdapter.findSession`, the call `/revoke-session` makes). No
 * signature is checked here, so a credential better-auth would go on to
 * ignore still counts when its token names a signed-in account. That is the
 * point: the step must see every account any later step on the request could
 * see, and refusing such a request costs no client anything it could
 * legitimately send.
 *
 * A token carrying a control character is no token the store holds, so it
 * names nobody (the same reading `resolveActor` gives it). When both tokens
 * are the same string they are one session, so nothing is read at all — the
 * Console's ordinary request costs no lookup.
 *
 * ## A lookup that cannot answer
 *
 * Fail-closed: when a session read throws, whether the request names one
 * account was never decided, so the request does not go on. It is answered
 * `503 SERVICE_UNAVAILABLE` — an outage, not a refusal of the credentials —
 * with the driver's failure on `cause`.
 *
 * ## Where it runs
 *
 * Two seams, one judgment ({@link requestNamesDifferentAccounts}):
 *
 *  - the global better-auth before-hook (`auth-manager-before-hook.ts`), first
 *    after the two steps that read nothing, so every better-auth endpoint
 *    answers it: over HTTP, and in process — `auth.api.getSession`, the
 *    session read every data door and every raw mount makes, throws it;
 *  - the identity mount's request seam (`auth-plugin.ts`, a middleware on the
 *    auth base path), ahead of every raw ObjectStack route there, which reads
 *    its caller in process and would otherwise meet the refusal as a throw.
 */

import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';

/** The refusal's wire code (ledgered under `@objectstack/plugin-auth`). */
export const CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE: RegisteredErrorCode = 'CREDENTIALS_NAME_DIFFERENT_ACCOUNTS';

/** The refusal's status: the request's authentication is not one account. */
export const CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_STATUS = 401;

/** The refusal's message: what is wrong, and what the caller does about it. */
export const CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_MESSAGE =
  'This request is signed in as two different accounts: its session cookie and its bearer token ' +
  'belong to different users, and a request is judged and executed as one account. Send one ' +
  'credential, or sign out of the account you do not mean to use, and retry.';

/** The standard ADR-0112 code a session store that cannot answer is given. */
export const ONE_ACCOUNT_READ_FAULT_CODE: StandardErrorCode = 'SERVICE_UNAVAILABLE';

/** The read fault's message. */
export const ONE_ACCOUNT_READ_FAULT_MESSAGE =
  'The sessions this request carries could not be read, so whether it is signed in as one account ' +
  'was never decided, and nothing was done. This is a server-side outage, not a refusal of the ' +
  'credentials: retry once the data store is reachable.';

/** The session cookie's default name, in every prefix spelling better-auth emits. */
const DEFAULT_SESSION_COOKIE = /^(?:__Secure-|__Host-)?better-auth\.session_token$/;

/** A header bag: a Web `Headers`, or anything with its `get`. */
export interface HeaderSource {
  get(name: string): string | null | undefined;
}

/** What better-auth's own session read answers (`internalAdapter.findSession`). */
interface FoundSession {
  session?: { userId?: unknown; expiresAt?: unknown } | null;
  user?: { id?: unknown } | null;
}

/** The two members of a better-auth context this judgment reads. */
export interface SessionReadContext {
  authCookies?: { sessionToken?: { name?: string } };
  internalAdapter?: { findSession?(token: string): Promise<FoundSession | null> };
}

/** A session read that threw: carries the driver's failure. */
export class OneAccountReadFault extends Error {
  readonly cause?: unknown;
  constructor(cause: unknown) {
    // `cause` is assigned by hand, as `AuthzStoreUnavailableError` does: the
    // ES2022 `ErrorOptions` overload is not at every consumer's compile target.
    super(ONE_ACCOUNT_READ_FAULT_MESSAGE);
    this.name = 'OneAccountReadFault';
    this.cause = cause;
  }
}

const tryDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The token part of a credential value: what precedes the first `.`. */
const tokenOf = (value: string): string | undefined => {
  const token = tryDecode(value.trim()).split('.')[0]?.trim() ?? '';
  return token.length > 0 ? token : undefined;
};

/** A token carrying a control character is none the store holds. */
const storable = (token: string): boolean =>
  !Array.from(token).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * The session-cookie value the request carries: the FIRST pair under the
 * cookie's name, as better-auth's own cookie parser keeps it; quotes stripped.
 */
function sessionCookieValue(cookieHeader: string, cookieName: string | undefined): string | undefined {
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (cookieName ? name !== cookieName : !DEFAULT_SESSION_COOKIE.test(name)) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    return value;
  }
  return undefined;
}

/**
 * The session tokens a request presents — the cookie's and the bearer's —
 * each without its signature. A credential that is absent, or not a
 * `Bearer` authorization, is left out.
 */
export function presentedSessionTokens(
  header: (name: string) => string,
  cookieName: string | undefined,
): { cookie?: string; bearer?: string } {
  const out: { cookie?: string; bearer?: string } = {};
  const bearer = /^Bearer\s+(.+)$/i.exec(header('authorization').trim());
  const bearerToken = bearer?.[1] ? tokenOf(bearer[1]) : undefined;
  if (bearerToken) out.bearer = bearerToken;
  const cookie = sessionCookieValue(header('cookie'), cookieName);
  const cookieToken = cookie ? tokenOf(cookie) : undefined;
  if (cookieToken) out.cookie = cookieToken;
  return out;
}

/**
 * The account a session token names: the user of a live session that carries
 * it, or `undefined` when no such session exists. A read that throws is
 * {@link OneAccountReadFault}.
 */
async function accountOf(token: string, context: SessionReadContext): Promise<string | undefined> {
  if (!storable(token)) return undefined;
  const findSession = context.internalAdapter?.findSession;
  if (typeof findSession !== 'function') return undefined;
  let found: FoundSession | null;
  try {
    found = await findSession.call(context.internalAdapter, token);
  } catch (cause) {
    throw new OneAccountReadFault(cause);
  }
  const session = found?.session;
  const userId = found?.user?.id ?? session?.userId;
  if (!session || userId === undefined || userId === null || String(userId) === '') return undefined;
  const expiresAt = session.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null) {
    const at = new Date(expiresAt as string | number | Date).getTime();
    if (!Number.isFinite(at) || at <= Date.now()) return undefined;
  }
  return String(userId);
}

/**
 * Does this request carry a session cookie and a bearer token that name two
 * DIFFERENT signed-in accounts? `false` for every other request — one
 * credential, one account, or a credential that names nobody.
 *
 * @throws {OneAccountReadFault} a session read that could not answer.
 */
export async function requestNamesDifferentAccounts(
  headers: HeaderSource | undefined,
  context: SessionReadContext | undefined,
  fallbackHeaders?: HeaderSource,
): Promise<boolean> {
  const header = (name: string): string =>
    String(headers?.get(name) ?? fallbackHeaders?.get(name) ?? '');
  const { cookie, bearer } = presentedSessionTokens(header, context?.authCookies?.sessionToken?.name);
  if (!cookie || !bearer || cookie === bearer || !context) return false;
  // The bearer first: on most requests that carry one beside a cookie it is
  // the cookie's own session, and a bearer that is no session token at all
  // (an API key, an OAuth access token) settles it in one read.
  const bearerAccount = await accountOf(bearer, context);
  if (!bearerAccount) return false;
  const cookieAccount = await accountOf(cookie, context);
  if (!cookieAccount) return false;
  return bearerAccount !== cookieAccount;
}

/**
 * The before-hook's step: refuse a request whose credentials name two
 * different accounts, with the ledgered code, before any gate runs. A session
 * read that cannot answer refuses too, as the outage it is.
 */
export async function refuseRequestNamingDifferentAccounts(ctx: any): Promise<void> {
  let differ: boolean;
  try {
    differ = await requestNamesDifferentAccounts(ctx?.headers, ctx?.context, ctx?.request?.headers);
  } catch (error) {
    if (!(error instanceof OneAccountReadFault)) throw error;
    const { APIError } = await import('better-auth/api');
    const fault = new APIError('SERVICE_UNAVAILABLE', {
      message: ONE_ACCOUNT_READ_FAULT_MESSAGE,
      code: ONE_ACCOUNT_READ_FAULT_CODE,
    });
    (fault as { cause?: unknown }).cause = error.cause;
    throw fault;
  }
  if (!differ) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError('UNAUTHORIZED', {
    message: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_MESSAGE,
    code: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE,
  });
}

/**
 * The identity mount's answer for the same judgment: the ADR-0112 envelope a
 * raw mount refuses with, or `null` when the request goes on. Same codes,
 * same statuses, same messages as {@link refuseRequestNamingDifferentAccounts}.
 */
export async function oneAccountRefusalAtMount(
  headers: HeaderSource,
  context: SessionReadContext | undefined,
): Promise<{ status: 401 | 503; body: { success: false; error: { code: string; message: string } } } | null> {
  try {
    if (!(await requestNamesDifferentAccounts(headers, context))) return null;
  } catch (error) {
    if (!(error instanceof OneAccountReadFault)) throw error;
    return {
      status: 503,
      body: { success: false, error: { code: ONE_ACCOUNT_READ_FAULT_CODE, message: ONE_ACCOUNT_READ_FAULT_MESSAGE } },
    };
  }
  return {
    status: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_STATUS,
    body: {
      success: false,
      error: { code: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE, message: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_MESSAGE },
    },
  };
}
