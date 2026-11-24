// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AuthGate } from '@objectstack/core';
import type { AIRouteCredentialKind } from '@objectstack/spec/contracts';

/**
 * Which kind of credential admitted a request's caller: the one reading the
 * dispatcher's environment-membership gate and the api-action forward both
 * take, so the two cannot disagree.
 *
 * - `oauth` when the principal was resolved from an OAuth access token (the
 *   envelope carries its `oauthScopes`; such a token is honoured on the MCP
 *   endpoint alone, and an in-process forward of it carries them too);
 * - else what the identity step's admission recorded: `api_key` or `session`;
 * - `undefined` when it recorded nothing (an anonymous caller).
 *
 * The three values are the spec's {@link AIRouteCredentialKind}, the one
 * vocabulary an AI route's `req.user.credential` carries too (#34184), so a
 * gate here and a door there cannot spell a credential two ways.
 */
export type AdmittingCredentialKind = AIRouteCredentialKind;

/** The two request facts {@link admittingCredentialKind} reads. */
export interface AdmittingCredentialFacts {
    executionContext?: { oauthScopes?: unknown };
    admission?: { credential: 'api_key' | 'session' };
}

export function admittingCredentialKind(request: AdmittingCredentialFacts | undefined): AdmittingCredentialKind | undefined {
    if (Array.isArray(request?.executionContext?.oauthScopes)) return 'oauth';
    return request?.admission?.credential;
}

/** The request facts {@link sessionAdmittedPrincipal} reads. */
export interface SessionAdmissionFacts {
    executionContext?: { userId?: unknown; oauthScopes?: unknown };
    admission?: { credential: 'api_key' | 'session'; authGate: AuthGate | undefined };
}

/**
 * The principal THIS request's own session read admitted, as the identity step
 * recorded it (`HttpDispatcher.resolveRequestScope`): the user id it resolved
 * and the ADR-0069 posture decided off that same read (`resolveAuthzContext`'s
 * session arm, `normalizeAuthGate(session.user)`). It is how a later seam of the
 * SAME request asks "who is the session, and does a policy hold it" without
 * reading the session again: one read per request, shared by every seam that
 * needs it.
 *
 * `undefined` unless the identity step resolved a principal from the request's
 * own session: an anonymous caller, an API key (judged by the key's own
 * answer), an OAuth access token or a forward credential (whose session the
 * door ESTABLISHED, so the request's own session was never read for it), and an
 * identity step that degraded to anonymous after the read all answer
 * `undefined`. Each of those keeps whatever read its seam made before.
 *
 * ⛔ Request-scoped by construction: it reads only the request object it is
 * handed, which the dispatcher builds per request. Never cache its answer
 * beyond the request.
 */
export function sessionAdmittedPrincipal(
    request: SessionAdmissionFacts | undefined,
): { userId: string; authGate: AuthGate | undefined } | undefined {
    if (admittingCredentialKind(request) !== 'session') return undefined;
    const userId = request?.executionContext?.userId;
    if (typeof userId !== 'string' || userId.length === 0) return undefined;
    return { userId, authGate: request?.admission?.authGate };
}
