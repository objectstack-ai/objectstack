// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22430] The API-description endpoint — the document (`GET {base}/openapi.json`)
 * — refuses an anonymous caller.
 *
 * `RestServer.registerOpenApiEndpoints` registers it on every base the server
 * mounts: the unscoped `/api/v1` and, under project scoping, its
 * `/environments/:environmentId` twin. The handler opens with the shared
 * anonymous-deny floor, so every base is driven here, in both directions:
 *
 *  - ANONYMOUS — `401` with the ADR-0112 `code` (`UNAUTHENTICATED`), the body
 *    byte-identical to the one the `/data` routes answer on the same server,
 *    nothing of the document in it, and no work done: the bundled artifact is
 *    never loaded and the protocol is never asked.
 *  - SIGNED-IN — served exactly as before: the document (an OpenAPI 3.1 body).
 *
 * [#25104] The document's viewer page (`GET {base}/docs`) was the second
 * endpoint here until it was retired. The assertions about it left with it,
 * `rest-docs-viewer-retired.pin.test.ts` pins that it is no longer served on
 * either base, and every assertion about the document stands.
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
] as const;

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
                // Nothing served: no document keys, no page.
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
        const data = await drive(rest, `${UNSCOPED}/data/:object`);
        // CONTROL: the `/data` route refuses the same anonymous request here, so
        // the comparison is between two refusals and not against a stuck value.
        expect(data.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(JSON.stringify(document.body)).toBe(JSON.stringify(data.body));
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

        it(`the document on ${base} describes its own endpoint as needing credentials — now true of it`, async () => {
            // The operation carries no `security` of its own, so it inherits the
            // document-level requirement; with the refusal in place that is the
            // truth about it, where before it under-claimed (see the coverage
            // note in `openapi-builtin-paths.ts`).
            const { rest } = signedIn();
            const doc: any = (await drive(rest, `${base}/openapi.json`, envOf(base))).body;
            expect(Array.isArray(doc.security) && doc.security.length > 0, 'the document states a requirement').toBe(true);
            const template = base.replace(':environmentId', '{environmentId}');
            for (const ep of ENDPOINTS) {
                const op = doc.paths?.[`${template}${ep.tail}`]?.get;
                expect(op, `${ep.name} is described in the document`).toBeDefined();
                expect(op).not.toHaveProperty('security');
            }
        });
    }
});

describe('[#22430] the floor is the shared one, not a bare anonymous check', () => {
    it('a session held by the ADR-0069 auth-policy gate is refused with that gate\'s 403', async () => {
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

    it('a permission-store outage keeps its declared 503 — never a 401, never a 200', async () => {
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
