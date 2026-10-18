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

import type { AuthSessionApi, IAuthService } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';

/** What the auth service's in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

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
 *
 * [#24222] Typed as `AuthSessionApi` declares the answer, read off the
 * contract's own `api` / `getApi()` members, no longer through `any`: both
 * callers' reads (`user.id`, `session.userId`) are declared there.
 */
export async function resolveSessionData(
    authService: IAuthService | undefined,
    headers: HeaderBag,
): Promise<SessionRead | null> {
    try {
        if (!authService) return undefined;
        let api = authService.api;
        if (!api && typeof authService.getApi === 'function') {
            api = await authService.getApi();
        }
        if (!api?.getSession) return undefined;
        // [#22258] The in-process session-read rule: a request carrying a
        // session cookie reads without renewal. Load-bearing here twice over —
        // the inbound rate limiter runs this on EVERY request, `/get-session`
        // included, so a renewal here would also leave the very route that
        // re-issues the cookie with nothing left to renew.
        return await api.getSession(inProcessSessionReadInput(toHeaders(headers)));
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
