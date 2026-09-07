// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { HttpDispatcher, type HttpDispatcherResult } from './http-dispatcher.js';

/**
 * The scoped-URL prefix is ONE convention, read three times in one request —
 * and the three readings had drifted apart.
 *
 * `dispatch()` handles an environment-scoped URL by reading the same prefix in
 * three places:
 *
 *   1. `extractEnvironmentIdFromPath` (via `prepareResolverHints`) parses the
 *      environment id out of it and hands it to the host's `KernelResolver`;
 *   2. the `acceptOAuthAccessToken` test decides whether an OAuth 2.1 access
 *      token is honoured, and runs against the STILL-SCOPED path;
 *   3. the scope strip removes the prefix so `DomainHandlerRegistry` — which
 *      matches from the head of the path — can claim the remainder.
 *
 * Reading 1 said `/environments/`; readings 2 and 3 still said the
 * pre-ADR-0006 `/projects/`. What that cost, measured through the real
 * `@objectstack/hono` catch-all before the repair:
 *
 * ```
 * GET /api/v1/environments/env_alpha/health     -> 404 ROUTE_NOT_FOUND
 * GET /api/v1/environments/env_alpha/data/task  -> 404 ROUTE_NOT_FOUND
 * GET /api/v1/health                 (control)  -> 200
 * GET /api/v1/data/task              (control)  -> 503 SERVICE_UNAVAILABLE (i.e. it REACHED /data)
 * GET /api/v1/projects/env_alpha/health         -> 200   <- stripped, but nothing ever parsed the id
 * ```
 *
 * The legacy spelling was not a working alias in exchange: nothing parses
 * `/projects/<id>`, so stripping it discarded the only place the environment
 * was named and served the request from the host default. ADR-0006 D2 retired
 * `project` on the API surface with NO aliases, and
 * `content/docs/api/environment-routing.mdx` tells callers to replace
 * `/api/v1/projects/:projectId/...` with `/api/v1/environments/:environmentId/...`
 * — so the repair is one spelling everywhere, not a two-prefix alternation.
 *
 * ## Why this suite drives `dispatch()` with a hand-derived subpath
 *
 * `packages/runtime` cannot depend on `@objectstack/hono` (that adapter depends
 * on THIS package). What the adapter contributes is one line —
 * `const subPath = c.req.path.substring(prefix.length)` in the
 * `app.all(`${prefix}/*`)` catch-all of `packages/adapters/hono/src/index.ts` —
 * so {@link subPathAsTheCatchAllDerivesIt} reproduces exactly that, and nothing
 * else. It matters that it is the catch-all: it is the ONLY entry that hands
 * `dispatch()` a still-scoped path. Every scoped mount in `dispatcher-plugin.ts`
 * passes a pre-stripped subpath (`registerAutomationRoutes` mounts
 * `${prefix}/environments/:environmentId/automation` but dispatches the literal
 * `'/automation'`), which is why the standalone server never saw this.
 */

const PREFIX = '/api/v1';
const ENV_ID = 'env_alpha';

/** The `@objectstack/hono` catch-all's one contribution, reproduced exactly. */
function subPathAsTheCatchAllDerivesIt(url: string): string {
    return url.substring(PREFIX.length);
}

/**
 * A kernel that provides NO services at all.
 *
 * Deliberate: it makes "which domain claimed the path" the only variable. A
 * claimed `/data` answers 503 SERVICE_UNAVAILABLE (the domain ran and found no
 * data service); an unclaimed path answers 404 ROUTE_NOT_FOUND. Those two are
 * the whole signal, and a kernel with services wired would blur them.
 */
function bareKernel(): any {
    return {
        getState: () => 'running',
        getService: () => undefined,
        getServiceAsync: async () => undefined,
    };
}

function dispatcher(): HttpDispatcher {
    return new HttpDispatcher(bareKernel(), undefined, { enforceProjectMembership: false });
}

/**
 * Narrow the optional `response`. Lifted from `http-dispatcher.ready.test.ts`
 * for the reason stated there: this package's test layer IS type-checked, and
 * `expect(res.response).toBeDefined()` narrows nothing. "Answered no response
 * at all" and "answered the wrong status" must stay distinguishable.
 */
function responseOf(res: HttpDispatcherResult, what: string): NonNullable<HttpDispatcherResult['response']> {
    const { response } = res;
    if (!response) throw new Error(`${what} answered no response at all`);
    return response;
}

/** `GET <url>` through the catch-all derivation; returns status + error code + the context it mutated. */
async function get(url: string): Promise<{ status: number; code: unknown; ctx: any }> {
    const ctx: any = { request: new Request(`http://pin.local${url}`) };
    const res = await dispatcher().dispatch('GET', subPathAsTheCatchAllDerivesIt(url), undefined, {}, ctx, PREFIX);
    const response = responseOf(res, `GET ${url}`);
    return { status: response.status, code: (response.body as any)?.error?.code, ctx };
}

describe('scoped-URL prefix — the environment-scoped URL reaches a dispatcher domain', () => {
    it('CONTROL: the unscoped forms reach their domains (a suite that measured nothing would fail here first)', async () => {
        expect((await get(`${PREFIX}/health`)).status).toBe(200);

        // `/data` has no exact/short-circuit answer, so it proves the DOMAIN ran
        // rather than merely that some route matched: the domain body is what
        // raises 503 on a missing data service.
        await expect(get(`${PREFIX}/data/task`)).rejects.toMatchObject({ statusCode: 503 });
    });

    it('NEGATIVE CONTROL: an unclaimed path answers 404 ROUTE_NOT_FOUND — the shape "matched no domain" takes', async () => {
        const res = await get(`${PREFIX}/no-such-domain`);
        expect(res.status).toBe(404);
        expect(res.code).toBe('ROUTE_NOT_FOUND');
    });

    it('the environment-scoped URL is stripped and reaches the same domain as the unscoped one', async () => {
        expect((await get(`${PREFIX}/environments/${ENV_ID}/health`)).status).toBe(200);
        await expect(get(`${PREFIX}/environments/${ENV_ID}/data/task`)).rejects.toMatchObject({ statusCode: 503 });
    });

    it('parses the environment id off the SAME prefix it strips — the two readings must not drift again', async () => {
        const { ctx } = await get(`${PREFIX}/environments/${ENV_ID}/health`);
        expect(ctx.urlEnvironmentId).toBe(ENV_ID);
    });

    it('the retired `/projects/` spelling resolves nothing — ADR-0006 D2 grants no alias', async () => {
        const res = await get(`${PREFIX}/projects/${ENV_ID}/health`);
        expect(res.status).toBe(404);
        expect(res.code).toBe('ROUTE_NOT_FOUND');

        // The point of removing it, stated as an assertion: this spelling was
        // never a working alias. Nothing parses it, so the pre-repair strip
        // deleted the only mention of the environment and served the request
        // from the host default. A 404 is the honest answer to a URL naming an
        // environment the dispatcher cannot resolve.
        expect(res.ctx.urlEnvironmentId).toBeUndefined();
    });
});

describe('scoped-URL prefix — the OAuth-on-MCP gate reads the same prefix', () => {
    /**
     * Capture the `acceptOAuthAccessToken` decision `resolveRequestScope`
     * computes. It is handed to a private method, so the instance-level
     * override is the observation seam; throwing afterwards is deliberate —
     * `resolveRequestScope` catches it and leaves `executionContext` undefined,
     * which is precisely the anonymous-request path and keeps this pin free of
     * any identity stack.
     */
    async function acceptsOAuthFor(url: string): Promise<boolean | undefined> {
        const d = dispatcher();
        let seen: boolean | undefined;
        (d as any).timedResolveExecutionContext = async (opts: { acceptOAuthAccessToken?: boolean }) => {
            seen = opts.acceptOAuthAccessToken;
            throw new Error('captured — anonymous from here');
        };
        const ctx: any = { request: new Request(`http://pin.local${url}`) };
        await d.resolveRequestScope(ctx, subPathAsTheCatchAllDerivesIt(url));
        return seen;
    }

    it('honours OAuth access tokens on the plain AND the environment-scoped MCP route', async () => {
        expect(await acceptsOAuthFor(`${PREFIX}/mcp`)).toBe(true);
        expect(await acceptsOAuthFor(`${PREFIX}/environments/${ENV_ID}/mcp`)).toBe(true);
    });

    it('CONTROL: refuses them off the MCP surface, and on the retired `/projects/` spelling', async () => {
        expect(await acceptsOAuthFor(`${PREFIX}/data/task`)).toBe(false);
        expect(await acceptsOAuthFor(`${PREFIX}/projects/${ENV_ID}/mcp`)).toBe(false);
    });
});
