// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22430] The API-description endpoints — the document (`GET {base}/openapi.json`)
 * and its viewer (`GET {base}/docs`) — refuse an anonymous caller.
 *
 * `RestServer.registerOpenApiEndpoints` registers both endpoints on every base
 * the server mounts: the unscoped `/api/v1` and, under project scoping, its
 * `/environments/:environmentId` twin. Both handlers now open with the shared
 * anonymous-deny floor, so every endpoint × base cell is driven here, in both
 * directions:
 *
 *  - ANONYMOUS — `401` with the ADR-0112 `code` (`UNAUTHENTICATED`), the body
 *    byte-identical to the one the `/data` routes answer on the same server,
 *    nothing of the document or the viewer page in it, and no work done: the
 *    bundled artifact is never loaded and the protocol is never asked.
 *  - SIGNED-IN — served exactly as before: the document (an OpenAPI 3.1 body),
 *    and the viewer page pointed at its sibling document on the same base.
 *
 * The anonymous leg drives the REAL identity chain: the server holds an auth
 * service whose session read answers "no session", which is what a request
 * without a cookie meets in production. The signed-in leg supplies the
 * resolved context directly — identity resolution is not the subject here, and
 * the booted-showcase proof (`showcase-anonymous-deny-surfaces.dogfood.test.ts`)
 * drives both legs through a real session over HTTP.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ANONYMOUS_DENY_BODY,
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_STATUS,
    AuthzStoreUnavailableError,
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import { RestServer } from './rest-server';

const UNSCOPED = '/api/v1';
const SCOPED = '/api/v1/environments/:environmentId';
const BASES = [UNSCOPED, SCOPED] as const;
const ENV = 'env_1';

const ENDPOINTS = [
    { name: 'the document', tail: '/openapi.json' },
    { name: 'the viewer', tail: '/docs' },
] as const;

/** The base as a caller spells it — the scoped pattern with a real id in it. */
const wireBase = (base: string) => base.replace(':environmentId', ENV);

function makeHttpServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn(), close: vi.fn(),
    } as any;
}

/** An auth service whose session read answers "no session" — a request with no cookie. */
const noSessionAuth = async () => ({ api: { getSession: vi.fn(async () => null) } });

/**
 * A server with BOTH bases mounted, its whole route table registered (the
 * document's built-in section is that table), and the two pieces of work a
 * refusal must not reach observable: the artifact load and the protocol read.
 */
function makeRest() {
    const protocol: any = {
        getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
        findData: vi.fn(async () => ({ records: [], total: 0 })),
    };
    const rest = new RestServer(
        makeHttpServer(),
        protocol,
        { api: { version: 'v1', enableProjectScoping: true, projectResolution: 'auto' } } as any,
        undefined, undefined, undefined,
        noSessionAuth,
    );
    rest.registerRoutes();
    const loadSpec = vi.spyOn(rest as any, 'loadOpenApiSpec');
    return { rest, protocol, loadSpec };
}

interface Observed {
    status: number;
    body: unknown;
    html: string | undefined;
    contentType: string | undefined;
}

async function drive(rest: RestServer, path: string, environmentId?: string): Promise<Observed> {
    const entry = (rest as any).routeManager.get('GET', path);
    expect(entry, `GET ${path} must be mounted for this case to mean anything`).toBeDefined();
    const observed: Observed = { status: 200, body: undefined, html: undefined, contentType: undefined };
    const res: any = {
        status: (c: number) => { observed.status = c; return res; },
        json: (b: unknown) => { observed.body = b; return res; },
        send: (html: string) => { observed.html = html; return res; },
        setHeader: (k: string, v: string) => { if (k.toLowerCase() === 'content-type') observed.contentType = v; return res; },
        header: () => res,
    };
    const wirePath = path.replace(':environmentId', ENV);
    await entry.handler({
        method: 'GET',
        path: wirePath,
        url: wirePath,
        params: environmentId ? { environmentId } : {},
        query: {},
        headers: { host: 'example.test' },
    }, res);
    return observed;
}

const envOf = (base: string) => (base === SCOPED ? ENV : undefined);

describe('[#22430] the API-description endpoints refuse an anonymous caller', () => {
    for (const base of BASES) {
        for (const ep of ENDPOINTS) {
            it(`${ep.name} on ${base} answers 401 UNAUTHENTICATED, serves nothing and does no work`, async () => {
                const { rest, protocol, loadSpec } = makeRest();
                const r = await drive(rest, `${base}${ep.tail}`, envOf(base));

                // The ADR-0112 envelope: status and code.
                expect(r.status).toBe(ANONYMOUS_DENY_STATUS);
                expect((r.body as any)?.code).toBe(ANONYMOUS_DENY_CODE);
                // The refusal body is the shared one, whole — not a lookalike.
                expect(r.body).toEqual(ANONYMOUS_DENY_BODY);
                // Nothing served: no document keys, no viewer page.
                expect(r.body).not.toHaveProperty('openapi');
                expect(r.body).not.toHaveProperty('paths');
                expect(r.html).toBeUndefined();
                expect(r.contentType).toBeUndefined();
                // And no work: the refusal precedes the artifact and the protocol.
                expect(loadSpec).not.toHaveBeenCalled();
                expect(protocol.getMetaItems).not.toHaveBeenCalled();
            });
        }
    }

    it('the refusal body is byte-identical to the anonymous 401 the `/data` routes answer on the same server', async () => {
        const { rest } = makeRest();
        const document = await drive(rest, `${UNSCOPED}/openapi.json`);
        const viewer = await drive(rest, `${UNSCOPED}/docs`);
        const data = await drive(rest, `${UNSCOPED}/data/:object`);
        // CONTROL: the `/data` route refuses the same anonymous request here, so
        // the comparison is between two refusals and not against a stuck value.
        expect(data.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(JSON.stringify(document.body)).toBe(JSON.stringify(data.body));
        expect(JSON.stringify(viewer.body)).toBe(JSON.stringify(data.body));
    });
});

describe('[#22430] a signed-in caller is served as before', () => {
    function signedIn() {
        const made = makeRest();
        (made.rest as any).resolveExecCtx = vi.fn(async () => ({ userId: 'u_docs_reader' }));
        return made;
    }

    for (const base of BASES) {
        it(`the document on ${base} is the OpenAPI 3.1 body`, async () => {
            const { rest, protocol } = signedIn();
            const r = await drive(rest, `${base}/openapi.json`, envOf(base));
            expect(r.status).toBe(200);
            expect((r.body as any)?.openapi).toBe('3.1.0');
            expect(Object.keys((r.body as any)?.paths ?? {}).length).toBeGreaterThan(0);
            // The enrichment ran: the protocol was asked for the object model.
            expect(protocol.getMetaItems).toHaveBeenCalledWith({ type: 'object' });
        });

        it(`the viewer on ${base} is the HTML page pointed at its sibling document`, async () => {
            const { rest } = signedIn();
            const r = await drive(rest, `${base}/docs`, envOf(base));
            expect(r.status).toBe(200);
            expect(r.contentType).toBe('text/html; charset=utf-8');
            expect(r.html).toContain(`data-url="${wireBase(base)}/openapi.json"`);
        });
    }
});

describe('[#22430] the floor is the shared one, not a bare anonymous check', () => {
    it('a session held by the ADR-0069 auth-policy gate is refused with that gate\'s 403, on both endpoints', async () => {
        const { rest, loadSpec } = makeRest();
        (rest as any).resolveExecCtx = vi.fn(async () => ({
            userId: 'u_gated',
            authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
        }));
        for (const ep of ENDPOINTS) {
            const r = await drive(rest, `${UNSCOPED}${ep.tail}`);
            expect(r.status, ep.name).toBe(403);
            expect((r.body as any)?.error?.code, ep.name).toBe('PASSWORD_EXPIRED');
            expect(r.html, ep.name).toBeUndefined();
        }
        expect(loadSpec).not.toHaveBeenCalled();
    });

    it('a permission-store outage keeps its declared 503 on both endpoints — never a 401, never a 200', async () => {
        const { rest } = makeRest();
        (rest as any).resolveExecCtx = vi.fn(async () => {
            throw new AuthzStoreUnavailableError('sys_user_permission_set');
        });
        for (const ep of ENDPOINTS) {
            const r = await drive(rest, `${UNSCOPED}${ep.tail}`);
            expect(r.status, ep.name).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
            expect(JSON.stringify(r.body), ep.name).toContain(AUTHZ_STORE_UNAVAILABLE_CODE);
            expect(r.html, ep.name).toBeUndefined();
        }
    });
});
