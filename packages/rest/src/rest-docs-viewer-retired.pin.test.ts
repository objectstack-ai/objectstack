// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25104] `GET {base}/docs`, the HTML viewer page for the OpenAPI document, is
 * retired: nothing read it, and the API origin serves no HTML viewer. The
 * machine-readable document, `GET {base}/openapi.json`, stays.
 *
 * Pinned on both route shapes the server mounts: the unscoped `/api/v1` and,
 * under project scoping, its `/environments/:environmentId` twin.
 *
 *  - NOT SERVED: no `{base}/docs` registration in the route table the server
 *    reports (`getRoutes()`, which the document's built-in section and the
 *    route ledger both read), none in the route manager's own lookup, and no
 *    `/docs` path handed to the host's `IHttpServer` under any verb. A request
 *    to the retired path therefore meets the host's ordinary not-found answer.
 *  - NOT DESCRIBED: the served document lists no `/docs` path.
 *  - THE DOCUMENT STAYS: `{base}/openapi.json` is registered on both shapes
 *    and serves a signed-in caller the OpenAPI 3.1 body.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const UNSCOPED = '/api/v1';
const SCOPED = '/api/v1/environments/:environmentId';
const BASES = [UNSCOPED, SCOPED] as const;
const ENV = 'env_1';
const VERBS = ['get', 'post', 'put', 'delete', 'patch'] as const;

function makeHttpServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn(), close: vi.fn(),
    } as any;
}

/** A server with both bases mounted and a signed-in caller resolved for every request. */
function makeRest() {
    const httpServer = makeHttpServer();
    const protocol: any = {
        getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
    };
    const rest = new RestServer(
        httpServer,
        protocol,
        { api: { version: 'v1', enableProjectScoping: true, projectResolution: 'auto' } } as any,
    );
    (rest as any).resolveExecCtx = vi.fn(async () => ({ userId: 'u_docs_reader' }));
    rest.registerRoutes();
    return { rest, httpServer };
}

/** Every path handed to the host, under any verb. */
function hostPaths(httpServer: any): string[] {
    return VERBS.flatMap((verb) => httpServer[verb].mock.calls.map((call: unknown[]) => String(call[0])));
}

async function serveDocument(rest: RestServer, base: string): Promise<{ status: number; body: any }> {
    const path = `${base}/openapi.json`;
    const entry = (rest as any).routeManager.get('GET', path);
    expect(entry, `GET ${path} must be mounted`).toBeDefined();
    const observed = { status: 200, body: undefined as any };
    const res: any = {
        status: (c: number) => { observed.status = c; return res; },
        json: (b: unknown) => { observed.body = b; return res; },
        send: () => res,
        setHeader: () => res,
        header: () => res,
    };
    const wirePath = path.replace(':environmentId', ENV);
    await entry.handler({
        method: 'GET',
        path: wirePath,
        url: wirePath,
        params: base === SCOPED ? { environmentId: ENV } : {},
        query: {},
        headers: { host: 'example.test' },
    }, res);
    return observed;
}

describe('[#25104] GET {base}/docs is not served, and GET {base}/openapi.json still is', () => {
    for (const base of BASES) {
        it(`${base}/docs has no registration: not in getRoutes(), not in the route manager, not on the host`, () => {
            const { rest, httpServer } = makeRest();
            const retired = `${base}/docs`;
            expect(rest.getRoutes().filter((r) => r.path === retired)).toEqual([]);
            for (const verb of VERBS) {
                expect((rest as any).routeManager.get(verb.toUpperCase(), retired), `${verb.toUpperCase()} ${retired}`).toBeUndefined();
            }
            expect(hostPaths(httpServer).filter((p) => p === retired)).toEqual([]);
        });

        it(`${base}/openapi.json stays registered, on the server and on the host`, () => {
            const { rest, httpServer } = makeRest();
            const kept = `${base}/openapi.json`;
            expect(rest.getRoutes().filter((r) => r.path === kept).map((r) => r.method.toUpperCase())).toEqual(['GET']);
            expect(hostPaths(httpServer).filter((p) => p === kept)).toEqual([kept]);
        });

        it(`the document served on ${base} is the OpenAPI 3.1 body, and it describes no /docs path`, async () => {
            const { rest } = makeRest();
            const { status, body } = await serveDocument(rest, base);
            expect(status).toBe(200);
            expect(body?.openapi).toBe('3.1.0');
            const paths = Object.keys(body?.paths ?? {});
            const template = base.replace(':environmentId', '{environmentId}');
            // CONTROL: the document describes its own route on this base, so the
            // absence below is read from a populated section.
            expect(paths).toContain(`${template}/openapi.json`);
            expect(paths.filter((p) => p.endsWith('/docs'))).toEqual([]);
        });
    }
});
