// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
 */
export type AdmittingCredentialKind = 'session' | 'api_key' | 'oauth';

/** The two request facts {@link admittingCredentialKind} reads. */
export interface AdmittingCredentialFacts {
    executionContext?: { oauthScopes?: unknown };
    admission?: { credential: 'api_key' | 'session' };
}

export function admittingCredentialKind(request: AdmittingCredentialFacts | undefined): AdmittingCredentialKind | undefined {
    if (Array.isArray(request?.executionContext?.oauthScopes)) return 'oauth';
    return request?.admission?.credential;
}
