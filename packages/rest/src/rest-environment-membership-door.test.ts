// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every data door judges environment membership — the ONE judgment the
 * runtime dispatcher asks (`judgeEnvironmentMembership`, `@objectstack/core`),
 * driven here through the UNSTUBBED identity resolution of `RestServer`.
 *
 * ## The host this file builds
 *
 * Two environments whose kernels each carry an `auth` service that accepts
 * the SAME platform session, so the credential is anchored in whichever
 * environment the request resolved to; the environment kernel's engine
 * registers `sys_environment_member` and holds one member. Every request is
 * aimed at that environment, on the scoped mount and on the unscoped one
 * (named by `X-Environment-Id`).
 *
 * ## What is pinned
 *
 *  - a signed-in NON-member's read and write are refused with the judgment's
 *    status and code, and the protocol is never reached;
 *  - the member is served (the control: the refusal cannot be satisfied by a
 *    server that refuses everyone);
 *  - the two conditions under which the judgment does not apply leave the
 *    non-member served exactly as before: the host's switch off
 *    (`api.enforceProjectMembership: false`), and an engine that registers no
 *    `sys_environment_member`;
 *  - a membership read that cannot answer is the loud outage, never served;
 *  - the composition root reads the switch through the same function the
 *    dispatcher's plugin does (`createRestApiPlugin`).
 */

import { describe, it, expect } from 'vitest';
import { resolveEnvironmentMembershipEnforcement } from '@objectstack/core';
import { RestServer } from './rest-server.js';
import type { RestEnvRegistry, RestKernelManager } from './rest-server.js';

const BASE = '/api/v1';
const SCOPED = `${BASE}/environments/:environmentId`;

const ENV_A = 'env_alpha';   // the default environment
const ENV_B = 'env_beta';    // the environment every request is aimed at

const MEMBER = 'u_member';
const OUTSIDER = 'u_outsider';

interface Reached { env: string; method: string }

function recordingProtocol(env: string, reached: Reached[]): any {
    const record = (method: string, answer: unknown) => async () => {
        reached.push({ env, method });
        return answer;
    };
    return {
        getMetaItem: async () => undefined,
        getMetaItems: async () => ({ items: [] }),
        findData: record('findData', { records: [{ id: `${env}_row` }], total: 1 }),
        createData: record('createData', { id: `${env}_new` }),
    };
}

interface EngineSpec {
    /** Whether the engine registers `sys_environment_member`. */
    registersMembership: boolean;
    /** Users holding a membership row for ENV_B. */
    members: string[];
    /** The membership read throws. */
    readFaults?: boolean;
}

/**
 * An engine whose every authorization lookup answers EMPTY (the principal is
 * the session's user id, no roles) except the membership read, which answers
 * from `spec.members`.
 */
function engine(spec: EngineSpec, membershipReads: unknown[]): any {
    const empty = async () => [];
    const registry = {
        getObject: (name: string) =>
            name === 'sys_environment_member' && !spec.registersMembership ? undefined : { name },
    };
    const find = async (object: string, query: any) => {
        if (object !== 'sys_environment_member') return [];
        membershipReads.push(query);
        if (spec.readFaults) throw new Error('control plane unreachable');
        const { environment_id, user_id } = query?.where ?? {};
        return environment_id === ENV_B && spec.members.includes(user_id) ? [{ id: 'm1', environment_id, user_id }] : [];
    };
    return new Proxy({}, {
        get: (_t, k: string) => {
            if (k === 'then') return undefined;
            if (k === 'registry') return registry;
            if (k === 'find') return find;
            return empty;
        },
    });
}

function wiring(userId: string, spec: EngineSpec) {
    const reached: Reached[] = [];
    const membershipReads: unknown[] = [];
    const kernelManager: RestKernelManager = {
        async getOrCreate(environmentId: string) {
            return {
                async getServiceAsync<T>(name: string): Promise<T> {
                    // The SHARED auth: every environment's kernel accepts the
                    // same platform session.
                    if (name === 'auth') {
                        return {
                            api: {
                                getSession: async () => ({
                                    user: { id: userId, email: `${userId}@example.test` },
                                    session: { userId },
                                }),
                            },
                        } as T;
                    }
                    if (name === 'objectql') return engine(spec, membershipReads) as T;
                    if (name === 'protocol') return recordingProtocol(environmentId, reached) as T;
                    return undefined as T;
                },
            } as any;
        },
    };
    return { kernelManager, reached, membershipReads };
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

function makeServer(w: ReturnType<typeof wiring>, enforced: boolean) {
    const http = recordingHttp();
    const provider = async () => undefined as any;
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
        /* 10 sharingServiceProvider       */ provider,
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
        /* 21 tenancyServiceProvider       */ undefined,
        /* 22 auditServiceProvider         */ undefined,
        /* 23 kernelServiceProvider        */ undefined,
        /* 24 environmentMembership        */ { enforced },
    ];
    const rs: any = new RestServer(...args);
    rs.registerRoutes();
    return http.table as Map<string, Handler>;
}

interface RouteCase { family: string; method: 'GET' | 'POST'; body?: unknown; downstream: string }

const ROUTES: RouteCase[] = [
    { family: 'read', method: 'GET', downstream: 'findData' },
    { family: 'write', method: 'POST', body: { name: 'x' }, downstream: 'createData' },
];

async function drive(table: Map<string, Handler>, route: RouteCase, mount: 'scoped' | 'unscoped') {
    const key = `${route.method} ${mount === 'scoped' ? SCOPED : BASE}/data/:object`;
    const handler = table.get(key);
    if (!handler) throw new Error(`route not mounted: ${key}`);
    const url = mount === 'scoped' ? `${BASE}/environments/${ENV_B}/data/account` : `${BASE}/data/account`;
    const req: any = {
        method: route.method,
        path: url,
        url,
        params: { object: 'account', ...(mount === 'scoped' ? { environmentId: ENV_B } : {}) },
        query: {},
        body: route.body,
        headers: {
            host: 'unbound.example.test',
            cookie: 'session=whatever',
            ...(mount === 'unscoped' ? { 'x-environment-id': ENV_B } : {}),
        },
    };
    let status = 200;
    let body: any;
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: unknown) { body = b; return res; },
        send(b: unknown) { body = b; return res; },
        header() { return res; },
        setHeader() { return res; },
    };
    let thrown: any;
    try { await handler(req, res); } catch (err) { thrown = err; }
    return { status, body, thrown };
}

const MOUNTS = ['scoped', 'unscoped'] as const;

describe('every data door judges environment membership', () => {
    for (const mount of MOUNTS) {
        for (const route of ROUTES) {
            it(`${mount} ${route.family}: a signed-in non-member is refused 403 PROJECT_MEMBERSHIP_REQUIRED and the protocol is never reached`, async () => {
                const w = wiring(OUTSIDER, { registersMembership: true, members: [MEMBER] });
                const { status, body } = await drive(makeServer(w, true), route, mount);
                expect(status).toBe(403);
                expect(body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
                expect(body?.error?.httpStatus).toBe(403);
                expect(body?.error?.details).toEqual({ environmentId: ENV_B, userId: OUTSIDER });
                expect(w.reached).toEqual([]);
                // The read is the platform's, keyed on the caller and the
                // environment the request resolved to.
                expect(w.membershipReads).toEqual([
                    { where: { environment_id: ENV_B, user_id: OUTSIDER }, limit: 1, context: { isSystem: true } },
                ]);
            });

            it(`${mount} ${route.family}: the member is served (control)`, async () => {
                const w = wiring(MEMBER, { registersMembership: true, members: [MEMBER] });
                const { status } = await drive(makeServer(w, true), route, mount);
                expect(status).toBeLessThan(300);
                expect(w.reached).toEqual([{ env: ENV_B, method: route.downstream }]);
            });

            it(`${mount} ${route.family}: the host switch off leaves the non-member served as before`, async () => {
                const w = wiring(OUTSIDER, { registersMembership: true, members: [MEMBER] });
                const { status } = await drive(makeServer(w, false), route, mount);
                expect(status).toBeLessThan(300);
                expect(w.reached).toEqual([{ env: ENV_B, method: route.downstream }]);
                expect(w.membershipReads).toEqual([]);
            });

            it(`${mount} ${route.family}: an engine with no sys_environment_member leaves the non-member served as before`, async () => {
                const w = wiring(OUTSIDER, { registersMembership: false, members: [] });
                const { status } = await drive(makeServer(w, true), route, mount);
                expect(status).toBeLessThan(300);
                expect(w.reached).toEqual([{ env: ENV_B, method: route.downstream }]);
                expect(w.membershipReads).toEqual([]);
            });

            it(`${mount} ${route.family}: a membership read that cannot answer is the loud outage, never served`, async () => {
                const w = wiring(OUTSIDER, { registersMembership: true, members: [], readFaults: true });
                const { status, body, thrown } = await drive(makeServer(w, true), route, mount);
                // This server's outage envelope carries the code at the top
                // level (`handleRouteError`); a throw would carry it on itself.
                const answered = thrown ? { status: thrown.status, code: thrown.code } : { status, code: body?.code };
                expect(answered).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
                expect(w.reached).toEqual([]);
            });
        }
    }
});

describe('the host switch is read through the one function both doors share', () => {
    it('explicit enforceProjectMembership wins; else on exactly when environment scoping is on', () => {
        expect(resolveEnvironmentMembershipEnforcement({ enforceProjectMembership: false, enableProjectScoping: true })).toBe(false);
        expect(resolveEnvironmentMembershipEnforcement({ enforceProjectMembership: true, enableProjectScoping: false })).toBe(true);
        expect(resolveEnvironmentMembershipEnforcement({ enableProjectScoping: true })).toBe(true);
        expect(resolveEnvironmentMembershipEnforcement({ enableProjectScoping: false })).toBe(false);
        expect(resolveEnvironmentMembershipEnforcement({})).toBe(false);
    });
});
