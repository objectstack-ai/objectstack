// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAuthService, PrincipalSession } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The ONE place this package reaches the auth service's principal-session
 * mint, `IAuthService.mintPrincipalSession`: a short-lived session for the
 * requesting user's own principal, so the browser loads the console as that
 * user and as nobody else. The print service never holds a system principal
 * and never forwards a credential it was handed.
 *
 * The mint mints for whatever user the context names, so it is handed the
 * incoming request's `ExecutionContext` UNCHANGED — the object the caller
 * passed, never one assembled here (pinned in `print-service.test.ts`).
 */

/** The minted session's cookie, under the auth service's own name and attributes. A secret. */
export type PrintSessionCookie = PrincipalSession['cookie'];

/** A minted session, as this package uses it. */
export type PrintSession = Pick<PrincipalSession, 'cookie' | 'token' | 'revoke'>;

/** What the print service asks of the mint. */
export interface PrincipalSessionMinter {
  /** Mint a session for `context`'s own user that lives at most `ttlSeconds`. */
  mint(context: ExecutionContext, ttlSeconds: number): Promise<PrintSession>;
}

/**
 * The mint of the registered `auth` service, or `undefined` when that service
 * is absent or its provider does not implement the optional member. Read at
 * call time, never cached, so a provider that registers later is seen.
 */
export function principalSessionMinterOf(auth: IAuthService | undefined): PrincipalSessionMinter | undefined {
  if (!auth || typeof auth.mintPrincipalSession !== 'function') return undefined;
  return { mint: (context, ttlSeconds) => auth.mintPrincipalSession!(context, { ttlSeconds }) };
}
