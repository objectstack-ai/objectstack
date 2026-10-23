// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential-environment comparison on EVERY route behind `enforceAuth`,
 * driven through the UNSTUBBED identity resolution.
 *
 * ## The fact this file is about
 *
 * `computeExecCtx` validates a caller against an `auth` service it finds in a
 * kernel, and it has a branch that finds one in the DEFAULT environment's
 * kernel when the resolved environment's kernel carries none. A session
 * minted in the default environment then authenticates a request aimed at
 * another environment. The context records which environment actually
 * validated the caller (`__authEnvironmentId`) and which environment the
 * request resolved to (`__environmentId`); `enforceAuth` — the one shared
 * entry point of the data plane — compares the two and refuses a mismatch
 * with the anonymous-deny response, byte for byte, so "valid elsewhere" is
 * indistinguishable from "not authenticated".
 *
 * `ui-view-environment-ownership.test.ts` pins the producer of
 * `__authEnvironmentId` and the UI-view seam; this file pins the rest of the
 * data plane: crud, data-action, batch and sharing, on both the scoped mount
 * (`/environments/:environmentId/...`) and the unscoped one (header-named).
 *
 * Each refusal carries two halves: the status and body, AND the downstream
 * (protocol or sharing service) was never reached. Each has a positive
 * control — the same wiring with the target environment carrying its own
 * `auth` service, which must be served — so the refusal cannot be satisfied
 * by a server that refuses everyone.
 */

import { describe, it, expect } from 'vitest';
import { ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { RestServer } from './rest-server.js';
import type { RestEnvRegistry, RestKernelManager } from './rest-server.js';

const BASE = '/api/v1';
const SCOPED = `${BASE}/environments/:environmentId`;

const ENV_A = 'env_alpha';   // the default environment
const ENV_B = 'env_beta';

interface Reached { env: string; method: string }

/**
 * A protocol that serves every call it is asked by recording it — the
 * downstream half of each pin. `getMetaItem` answers no item, so the object
 * carries no exposure policy and `enforceApiAccess` lets the call through.
 */
function recordingProtocol(env: string, reached: Reached[]): any {
    const record = (method: string, answer: unknown) => async () => {
        reached.push({ env, method });
        return answer;
    };
    return {
        getMetaItem: async () => undefined,
        getMetaItems: async () => ({ items: [] }),
        findData: record('findData', { records: [{ id: `${env}_row` }], total: 1 }),
        getData: record('getData', { record: { id: `${env}_row` } }),
        createData: record('createData', { id: `${env}_new` }),
        cloneData: record('cloneData', { id: `${env}_clone` }),
        createManyData: record('createManyData', [{ id: `${env}_many` }]),
        batchData: record('batchData', { results: [] }),
    };
}

/** Every lookup answers EMPTY: the principal is the session's user id, no roles. */
function emptyQl(): any {
    const empty = async () => [];
    return new Proxy({}, { get: (_t, k: string) => (k === 'then' ? undefined : empty) });
}

function authServiceFor(userId: string): any {
    return {
        api: {
            getSession: async () => ({ user: { id: userId, email: `${userId}@example.test` }, session: { userId } }),
        },
    };
}

/** `authUserId` absent = that environment's kernel carries NO `auth` service. */
function wiring(spec: Record<string, { authUserId?: string }>) {
    const reached: Reached[] = [];
    const objectqlFrom: string[] = [];
    const kernelManager: RestKernelManager = {
        async getOrCreate(environmentId: string) {
            const entry = spec[environmentId];
            return {
                async getServiceAsync<T>(name: string): Promise<T> {
                    if (name === 'auth') {
                        if (!entry?.authUserId) throw new Error(`no auth service in ${environmentId}`);
                        return authServiceFor(entry.authUserId) as T;
                    }
                    if (name === 'objectql') { objectqlFrom.push(environmentId); return emptyQl() as T; }
                    if (name === 'protocol') return recordingProtocol(environmentId, reached) as T;
                    // Absent services resolve `undefined` — the registry's
                    // quiet absence, not a construction fault.
                    return undefined as T;
                },
            } as any;
        },
    };
    return { kernelManager, reached, objectqlFrom };
}

const envRegistry: RestEnvRegistry = {
    async resolveByHostname() { return null; },
    async resolveById(environmentId: string) {
        return environmentId === ENV_A || environmentId === ENV_B ? { driver: environmentId } : null;
    },
};

type Handler = (req: any, res: any) => any;

function recordingHttp() {
    const table = new Map<string, Handler>();
    const on = (m: string) => (p: string, h: Handler) => { table.set(`${m} ${p}`, h); };
    return {
        table,
        get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
        use: () => {}, listen: async () => {}, close: async () => {},
    } as any;
}

function makeServer(w: ReturnType<typeof wiring>) {
    const http = recordingHttp();
    const provider = async () => undefined as any;
    const sharingFor = async (environmentId?: string) => ({
        listShares: async () => {
            w.reached.push({ env: environmentId ?? '(unscoped)', method: 'listShares' });
            return [{ id: 'share_1' }];
        },
    });
    const args: ConstructorParameters<typeof RestServer> = [
        /*  1 server                       */ http,
        /*  2 protocol (control plane)     */ recordingProtocol('platform', w.reached),
        /*  3 config                       */ { api: { enableProjectScoping: true, projectResolution: 'auto' } },
        /*  4 kernelManager                */ w.kernelManager,
        /*  5 envRegistry                  */ envRegistry,
        /*  6 defaultEnvironmentIdProvider */ () => ENV_A,
        /*  7 authServiceProvider          */ undefined,
        /*  8 objectQLProvider             */ provider,
        /*  9 emailServiceProvider         */ provider,
        /* 10 sharingServiceProvider       */ sharingFor,
        /* 11 (retired saved-report slot)  */ undefined,
        /* 12 approvalsServiceProvider     */ provider,
        /* 13 sharingRulesServiceProvider  */ provider,
        /* 14 i18nServiceProvider          */ provider,
        /* 15 analyticsServiceProvider     */ provider,
        /* 16 settingsServiceProvider      */ provider,
        /* 17 serviceExistsProvider        */ () => false,
        /* 18 securityServiceProvider      */ provider,
        /* 19 requestEnvResolver           */ undefined,
        /* 20 metadataServiceProvider      */ provider,
    ];
    const rs: any = new RestServer(...args);
    rs.registerRoutes();
    return { rs, table: http.table as Map<string, Handler> };
}

interface RouteCase {
    family: string;
    method: 'GET' | 'POST';
    /** Path below the base (scoped or unscoped). */
    path: string;
    params: Record<string, string>;
    body?: unknown;
    /** The downstream call that serving the request makes. */
    downstream: string;
}

const ROUTES: RouteCase[] = [
    { family: 'crud read', method: 'GET', path: '/data/:object', params: { object: 'account' }, downstream: 'findData' },
    { family: 'crud write', method: 'POST', path: '/data/:object', params: { object: 'account' }, body: { name: 'x' }, downstream: 'createData' },
    { family: 'data-action', method: 'POST', path: '/data/:object/:id/clone', params: { object: 'account', id: 'r1' }, body: {}, downstream: 'cloneData' },
    { family: 'batch', method: 'POST', path: '/data/:object/createMany', params: { object: 'account' }, body: [{ name: 'x' }], downstream: 'createManyData' },
    { family: 'sharing', method: 'GET', path: '/data/:object/:id/shares', params: { object: 'account', id: 'r1' }, downstream: 'listShares' },
];

async function drive(
    table: Map<string, Handler>,
    route: RouteCase,
    mount: 'scoped' | 'unscoped',
    target: string,
) {
    const key = `${route.method} ${mount === 'scoped' ? SCOPED : BASE}${route.path}`;
    const handler = table.get(key);
    if (!handler) throw new Error(`route not mounted: ${key}`);
    const concrete = route.path.replace(/:(\w+)/g, (_m, k) => route.params[k] ?? `:${k}`);
    const url = mount === 'scoped' ? `${BASE}/environments/${target}${concrete}` : `${BASE}${concrete}`;
    const req: any = {
        method: route.method,
        path: url,
        url,
        params: { ...route.params, ...(mount === 'scoped' ? { environmentId: target } : {}) },
        query: {},
        body: route.body,
        headers: {
            host: 'unbound.example.test',
            cookie: 'session=whatever',
            ...(mount === 'unscoped' ? { 'x-environment-id': target } : {}),
        },
    };
    let status = 0; let body: any; let sent = false;
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: any) { body = b; sent = true; },
        send() { sent = true; }, header() { return res; }, setHeader() { return res; },
        end() { sent = true; }, write() { return true; }, type() { return res; },
    };
    await handler(req, res);
    return { status: status || (sent ? 200 : 0), body };
}

describe('a default-environment credential aimed at another environment', () => {
    for (const mount of ['scoped', 'unscoped'] as const) {
        for (const route of ROUTES) {
            it(`⭐ is REFUSED on ${route.family} (${route.method} ${route.path}, ${mount}) — and nothing downstream runs`, async () => {
                // B carries no `auth` service, so the identity lookup falls
                // back to A's and authenticates A's session for a request
                // that resolved to B.
                const w = wiring({ [ENV_A]: { authUserId: 'u_alpha' }, [ENV_B]: {} });
                const { table } = makeServer(w);

                const out = await drive(table, route, mount, ENV_B);

                expect(out.status).toBe(ANONYMOUS_DENY_STATUS);
                // Byte-identical to the anonymous answer: "valid elsewhere"
                // must not be distinguishable from "not authenticated".
                expect(JSON.stringify(out.body)).toBe(JSON.stringify(ANONYMOUS_DENY_BODY));
                expect(w.reached).toEqual([]);
            }, 60_000);

            it(`POSITIVE CONTROL — the target environment's own credential is served on ${route.family} (${mount})`, async () => {
                const w = wiring({ [ENV_A]: { authUserId: 'u_alpha' }, [ENV_B]: { authUserId: 'u_beta' } });
                const { table } = makeServer(w);

                const out = await drive(table, route, mount, ENV_B);

                expect(out.status).toBeGreaterThanOrEqual(200);
                expect(out.status).toBeLessThan(300);
                expect(w.reached.map((r) => r.method)).toEqual([route.downstream]);
            }, 60_000);

            it(`POSITIVE CONTROL — the default environment's credential, aimed at the default environment, is served on ${route.family} (${mount})`, async () => {
                const w = wiring({ [ENV_A]: { authUserId: 'u_alpha' }, [ENV_B]: {} });
                const { table } = makeServer(w);

                const out = await drive(table, route, mount, ENV_A);

                expect(out.status).toBeGreaterThanOrEqual(200);
                expect(out.status).toBeLessThan(300);
                expect(w.reached.map((r) => r.method)).toEqual([route.downstream]);
            }, 60_000);
        }
    }
});

describe('the context records both sides of the comparison', () => {
    it('names the resolved environment beside the one that validated the caller', async () => {
        const w = wiring({ [ENV_A]: { authUserId: 'u_alpha' }, [ENV_B]: {} });
        const { rs } = makeServer(w);
        const ctx = await rs.resolveExecCtx(ENV_B, { headers: { cookie: 'session=whatever' }, method: 'GET' });

        expect(ctx?.userId).toBe('u_alpha');
        expect(ctx.__environmentId).toBe(ENV_B);
        expect(ctx.__authEnvironmentId).toBe(ENV_A);
        // The principal was also resolved against A's engine, not B's: the
        // crossing is not only "who" but "whose permission store".
        expect(w.objectqlFrom).toEqual([ENV_A]);
    }, 60_000);

    it('names the same environment twice when the target carries its own auth service', async () => {
        const w = wiring({ [ENV_A]: { authUserId: 'u_alpha' }, [ENV_B]: { authUserId: 'u_beta' } });
        const { rs } = makeServer(w);
        const ctx = await rs.resolveExecCtx(ENV_B, { headers: { cookie: 'session=whatever' }, method: 'GET' });

        expect(ctx?.userId).toBe('u_beta');
        expect(ctx.__environmentId).toBe(ENV_B);
        expect(ctx.__authEnvironmentId).toBe(ENV_B);
    }, 60_000);
});
