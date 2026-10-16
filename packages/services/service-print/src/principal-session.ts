// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The ONE place this package reaches the auth service's principal-session
 * mint: an optional `IAuthService` member that mints a short-lived session for
 * the requesting user's own principal, so the browser loads the console as
 * that user and as nobody else. The print service never holds a system
 * principal and never forwards a credential it was handed.
 *
 * ## Binding
 *
 * The member, its name and its shape belong to the auth contract
 * (`IAuthService.mintPrincipalSession`, `@objectstack/spec/contracts`). Until
 * that member is on the contract this adapter mirrors its shape locally and
 * reads it off the registered `auth` service by name; once it is, the three
 * local types below become imports from `@objectstack/spec/contracts`
 * (`PrincipalSession`, `PrincipalSessionCookie`) and the read becomes a typed
 * call on `IAuthService`. Nothing else in the package changes: every other
 * file reaches the mint through {@link principalSessionMinterOf}.
 */

/** The minted session's cookie, under the auth service's own name and attributes. A secret. */
export interface PrintSessionCookie {
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  domain?: string;
}

/** A minted session, as this package uses it. */
export interface PrintSession {
  /** The session cookie the browser loads the console with. */
  cookie: PrintSessionCookie;
  /** The session as a bearer token. Never used here; held only so it can be redacted. */
  token: string;
  /** End the session. Safe to call more than once. */
  revoke(): Promise<void>;
}

/** What the print service asks of the mint. */
export interface PrincipalSessionMinter {
  /** Mint a session for `context`'s own user that lives at most `ttlSeconds`. */
  mint(context: ExecutionContext, ttlSeconds: number): Promise<PrintSession>;
}

/** The member as the auth contract declares it. */
type MintMember = (
  context: ExecutionContext,
  options?: { ttlSeconds?: number },
) => Promise<PrintSession>;

/**
 * The mint of the registered `auth` service, or `undefined` when that service
 * is absent or offers no principal-session mint. Read at call time, never
 * cached, so a provider that registers later is seen.
 */
export function principalSessionMinterOf(auth: unknown): PrincipalSessionMinter | undefined {
  if (!auth || typeof auth !== 'object') return undefined;
  const member = (auth as { mintPrincipalSession?: unknown }).mintPrincipalSession;
  if (typeof member !== 'function') return undefined;
  const mint = member as MintMember;
  return { mint: (context, ttlSeconds) => mint.call(auth, context, { ttlSeconds }) };
}
