// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16383] `@objectstack/hono` must hand a dispatcher result that IS a
 * `Response` to the caller AS ITSELF — real status, real body, real headers.
 *
 * ## The defect this file was written against
 *
 * `HttpDispatcherResult.result` is DECLARED for direct response objects
 * (`packages/runtime/src/http-dispatcher.ts`: "For flexible return types or
 * direct response objects (Response/NextResponse)"), and the runtime really
 * puts one there: `packages/runtime/src/domains/auth.ts` forwards whatever the
 * auth service answered as `{ handled: true, result: response }`. That producer
 * half is pinned on its own side by
 * `runtime/src/domains/auth-claim-segment-boundary.test.ts` and
 * `runtime/src/auth-forward-fault-sanitization.test.ts`; this file is the
 * consumer half.
 *
 * The adapter's `toResponse` fell past its `redirect` and `stream` arms into
 * `c.json(res, 200)`. A Fetch `Response` has no own enumerable properties, so
 * `JSON.stringify` of one is `{}`, and the `200` was a literal — so every
 * status a door produced reached the caller as `200 {}` with the producer's
 * headers gone.
 *
 * ⭐ That is not a missing answer, it is a WRONG answer that reads as success,
 * and it defeats fail-closed guards rather than merely missing them: objectui's
 * `MePermissionsProvider.tsx` refuses on `if (!data) return false`, and `{}` is
 * truthy.
 *
 * ## ⚠️ Why this lives HERE and not in the adapter's own suite
 *
 * `@objectstack/hono` has NO in-repo consumer (#4117), so there is nothing to
 * observe this through except a CONSTRUCTED BOOT — and the adapter's own suite
 * cannot be that boot for this question: `packages/adapters/hono/vitest.config.ts`
 * aliases `@objectstack/runtime` to a hand-written stub, so no spelling of that
 * specifier reaches the real `HttpDispatcher` from inside that package. The
 * adapter-local pin
 * (`packages/adapters/hono/src/hono-result-response-passthrough.test.ts`) pins
 * the RENDERING against that stub, over every status and every `result` shape;
 * this file pins that the two packages still meet — a real `LiteKernel`, the
 * real `HttpDispatcher` the adapter constructs for itself, the real `/auth`
 * domain, requests injected through the returned Hono app and read off the
 * wire. Neither half is redundant: the local one fails fast on an adapter edit,
 * this one fails when the contract between the packages moves.
 *
 * ## ⭐ The route these rows drive, and why it is the ONLY one that reaches the arm
 *
 * Measured on this boot, all four statuses over `/auth`, `/auth/`,
 * `/auth/me/permissions` and `/auth/whatever`: the adapter's
 * `${prefix}/auth/*` mount answers a 200 / 403 / 500 ITSELF, from its own
 * `forwarded()` — those never reach `toResponse` at all. Only a **404** is
 * disclaimed (#4088 / #15928: the mount yields a 404 the auth service does not
 * own), and only then does the `${prefix}/*` catch-all reach `dispatch()`, the
 * `/auth` domain claim the path, and the auth service's `Response` arrive in
 * `HttpDispatcherResult.result`.
 *
 * That is why `handleRequest` call COUNT is asserted beside every status here
 * and is not decoration: **2 means the arm under test ran** (the mount called
 * the service, disclaimed, yielded; the domain called it again), **1 means the
 * mount answered and `toResponse` was never consulted**. Without it a row could
 * go green through a path that has nothing to do with this card. The status
 * matrix over arbitrary `result` values belongs to the adapter-local pin, which
 * can drive the arm directly.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';

/** A refusal body a real door writes — a payload, not an empty envelope. */
const REFUSAL_BODY = { message: 'Not found', code: 'NOT_FOUND', hint: 'no such endpoint' };

/**
 * Boot the real stack: a real `LiteKernel` carrying an `auth` service in the
 * shape the kernel really registers, and the adapter's own real
 * `HttpDispatcher` behind `createHonoApp`.
 *
 * ⛔ No `ownsRoute` on the service: these are DISCLAIMED paths, which is what
 * makes the mount yield instead of answering — the only way a `Response` gets
 * into `HttpDispatcherResult.result` on this composition.
 */
async function bootApp(status: number, body: unknown) {
    const seen: string[] = [];
    const kernel = new LiteKernel();
    kernel.use({
        metadata: { name: 'test-auth-door', version: '1.0.0' },
        init: (c: any) => c.registerService('auth', {
            handleRequest: async (req: Request) => {
                seen.push(`${req.method} ${new URL(req.url).pathname}`);
                return new Response(JSON.stringify(body), {
                    status,
                    headers: { 'Content-Type': 'application/json', 'X-Door': 'auth' },
                });
            },
        }),
    } as any);
    await kernel.bootstrap();
    return { app: createHonoApp({ kernel: kernel as any, prefix: PREFIX }), seen };
}

describe('#16383: a dispatcher result that IS a Response survives the hono adapter intact', () => {
    it('answers the door\'s REAL status and REAL body, not a hard-coded 200 with `{}`', async () => {
        const { app, seen } = await bootApp(404, REFUSAL_BODY);
        const res = await app.request(`http://localhost${PREFIX}/auth/me/permissions`);

        // The arm under test really ran — see the header. Asserted FIRST so a
        // routing change that stops reaching `toResponse` reads as this row's
        // failure and not as a passing status assertion.
        expect(seen).toHaveLength(2);

        expect(res.status).toBe(404);
        // ⭐ Both halves are load-bearing and the second is the one a weaker pin
        // drops: a repair that answered SOME non-200 with a destroyed body would
        // satisfy the status assertion alone while still puncturing every caller
        // that reads the payload — `{}` is truthy.
        await expect(res.clone().json()).resolves.toEqual(REFUSAL_BODY);
        await expect(res.clone().text()).resolves.not.toBe('{}');
        // The producer's own headers are part of "the real Response", and
        // rebuilding the body would drop them silently.
        expect(res.headers.get('x-door')).toBe('auth');
        expect(res.headers.get('content-type')).toContain('application/json');
    }, 30_000);

    it('is the same answer on every disclaimed path under the mount', async () => {
        for (const path of ['/auth', '/auth/', '/auth/whatever']) {
            const { app, seen } = await bootApp(404, REFUSAL_BODY);
            const res = await app.request(`http://localhost${PREFIX}${path}`);
            expect(seen, path).toHaveLength(2);
            expect(res.status, path).toBe(404);
            await expect(res.json(), path).resolves.toEqual(REFUSAL_BODY);
        }
    }, 30_000);

    it('CONTROL — a 403 the mount answers ITSELF is untouched, and says so with one call', async () => {
        // Anti-vacuity, two ways. It proves this harness can tell the two arms
        // apart (one call, not two), so the rows above are not green by way of
        // some path that never consults `toResponse`; and it proves the fix did
        // not disturb the mount's own direct answer, which #15928 owns.
        const { app, seen } = await bootApp(403, { message: 'nope', code: 'FORBIDDEN' });
        const res = await app.request(`http://localhost${PREFIX}/auth/me/permissions`);

        expect(seen).toHaveLength(1);
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({ message: 'nope', code: 'FORBIDDEN' });
    }, 30_000);
});
