// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Who is calling?", asked of the auth service from OUTSIDE a dispatch.
 *
 * Two consumers need this and they run in different kernel phases, which is why
 * it is a module rather than a closure: `dispatcher-plugin`'s concrete route
 * mounts build a slim `req.user` from it in `start()`, and the inbound rate
 * limiter (#4910) needs only the principal id, in `init()`, to key a bucket
 * before any route runs. One lookup, one set of defensive rules, so the two
 * cannot drift on what counts as "authenticated".
 *
 * Every failure mode here resolves to `undefined` — meaning ANONYMOUS, not
 * "error". Both callers treat anonymous as a legitimate state (the route's own
 * auth gate still runs; the limiter keys by IP instead), so throwing would turn
 * an auth hiccup into an outage on surfaces that never needed auth to begin
 * with.
 */

import type { IAuthService } from '@objectstack/spec/contracts';

/** Headers as adapters deliver them, or an already-built `Headers`. */
export type HeaderBag = Record<string, unknown> | Headers;

function toHeaders(headers: HeaderBag): Headers {
    if (headers instanceof Headers) return headers;
    const out = new Headers();
    for (const key of Object.keys(headers)) {
        const value = (headers as Record<string, unknown>)[key];
        if (value == null) continue;
        out.set(String(key), Array.isArray(value) ? value.join(',') : String(value));
    }
    return out;
}

/**
 * The better-auth session payload for a request, or `undefined` when there is
 * no auth service, no session API, or no session.
 */
export async function resolveSessionData(
    authService: IAuthService | undefined,
    headers: HeaderBag,
): Promise<any | undefined> {
    try {
        if (!authService) return undefined;
        let api: any = (authService as any).api;
        if (!api && typeof (authService as any).getApi === 'function') {
            api = await (authService as any).getApi();
        }
        if (!api?.getSession) return undefined;
        return await api.getSession({ headers: toHeaders(headers) });
    } catch {
        return undefined;
    }
}

/**
 * The calling principal's user id, or `undefined` for anonymous traffic.
 */
export async function resolveSessionPrincipalId(
    authService: IAuthService | undefined,
    headers: HeaderBag,
): Promise<string | undefined> {
    const sessionData = await resolveSessionData(authService, headers);
    const userId: unknown = sessionData?.user?.id ?? sessionData?.session?.userId;
    return typeof userId === 'string' && userId.length > 0 ? userId : undefined;
}
