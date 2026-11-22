// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which identity provider a session was signed in through.
 *
 * Deleting an SSO provider ends the sessions a sign-in through it opened, and
 * removes its projected grants (`sso-provider-lifecycle.ts`, "Deleting a
 * provider"): the live sessions those sign-ins opened are revoked with it. A session
 * row does not say how it was obtained, so each session an SSO sign-in mints
 * records its provider in `sys_session.sso_provider_id`
 * ({@link SESSION_SSO_PROVIDER_FIELD}), and the delete revokes the live rows
 * that name the deleted provider. A session obtained any other way (a
 * password, another provider, an impersonation) names no provider, or
 * another one, and is left as it is.
 *
 * ## Where the provider is known
 *
 * `@better-auth/sso` (1.7.12) hands every sign-in it authenticates to
 * better-auth's `handleOAuthUserInfo` with `source: { method: 'sso-oidc' |
 * 'sso-saml', sso: { providerId } }`, for every callback door (the OIDC
 * per-provider and shared callbacks, the SAML ACS, SP- or IdP-initiated), and
 * better-auth passes that source to the `validateUserInfo` seam on each of its
 * actions (`create-user`, `link-account`, `sign-in`). That seam may still
 * refuse the sign-in and runs before the session exists, so it only STAGES the
 * provider, scoped to the request ({@link stageSsoSignInProvider}). The
 * session the sign-in mints is then written, and `session.create.after`
 * SETTLES it on that row ({@link settleSsoSignInProvider}). A refused sign-in
 * mints no session, and the staged provider dies with its request. This is
 * the stage-and-settle shape `idp-locale-claim.ts` uses for the same seam.
 *
 * ## When the record cannot be written
 *
 * The sign-in is not failed: the IdP has authenticated the user, and the
 * session works as any other. It is said at `error`, once per sign-in, because
 * nothing else would show it: the session looks like every other SSO session,
 * while deleting its provider would leave it live.
 */

import type { IDataEngine } from '@objectstack/core';
import { withSystemContext } from './objectql-adapter.js';

const SESSION_OBJECT = 'sys_session';

/** The `sys_session` column naming the SSO provider a session was signed in through. */
export const SESSION_SSO_PROVIDER_FIELD = 'sso_provider_id';

/** The `validateUserInfo` source methods of an `@better-auth/sso` sign-in. */
const SSO_SIGN_IN_METHODS = new Set(['sso-oidc', 'sso-saml']);

/**
 * The provider an SSO sign-in's `validateUserInfo` source names, or
 * `undefined` when the source is not an SSO sign-in or names none.
 */
export function ssoSignInProviderOf(source: unknown): string | undefined {
  const s = source as { method?: unknown; sso?: { providerId?: unknown } | null } | null | undefined;
  if (typeof s?.method !== 'string' || !SSO_SIGN_IN_METHODS.has(s.method)) return undefined;
  const providerId = s.sso?.providerId;
  return typeof providerId === 'string' && providerId.length > 0 ? providerId : undefined;
}

/** Scoped to the request: an entry dies with the endpoint context that staged it. */
const staged = new WeakMap<object, string>();

/** The `validateUserInfo` half: stage the provider of an SSO sign-in. Never throws, never refuses. */
export function stageSsoSignInProvider(data: unknown, ctx: unknown): void {
  if (!ctx || typeof ctx !== 'object') return;
  const providerId = ssoSignInProviderOf((data as { source?: unknown } | null | undefined)?.source);
  if (providerId) staged.set(ctx, providerId);
}

/**
 * The `session.create.after` half: record on the session just minted the
 * provider its request staged. Nothing staged (not an SSO sign-in), no
 * session id or no engine: nothing is written. Never throws.
 */
export async function settleSsoSignInProvider(
  session: unknown,
  ctx: unknown,
  engine: IDataEngine | null | undefined,
  logError: (message: string) => void,
): Promise<void> {
  if (!ctx || typeof ctx !== 'object') return;
  const providerId = staged.get(ctx);
  if (!providerId) return;
  staged.delete(ctx);
  const sessionId = (session as { id?: unknown } | null | undefined)?.id;
  if (typeof sessionId !== 'string' || !sessionId) return;
  try {
    if (!engine) throw new Error('no data engine to write the session through');
    await withSystemContext(engine).update(
      SESSION_OBJECT,
      { id: sessionId, [SESSION_SSO_PROVIDER_FIELD]: providerId },
      { context: { isSystem: true } },
    );
  } catch (error) {
    logError(
      `[auth] SSO sign-in through provider '${providerId}' SUCCEEDED, but recording on session ${sessionId} that it was `
        + 'signed in through that provider FAILED: deleting the provider will NOT end this session, which stays live '
        + 'until it expires or is revoked. Remedy: fix the cause; the next sign-in records it again, and an administrator '
        + `can revoke the session (POST /api/v1/auth/sys-session/revoke). Cause: ${(error as Error)?.message ?? String(error)}`,
    );
  }
}
