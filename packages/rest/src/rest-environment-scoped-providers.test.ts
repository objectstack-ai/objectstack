// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30011] The five environment-scoped provider seams — approvals, email,
 * sharing, sharing rules and analytics — answer a request from the REQUEST's
 * environment kernel, in the hosted shape: one REST plugin on a host kernel in
 * front of many environment kernels.
 *
 * ## The shape, and why it is booted rather than imitated
 *
 * Cloud mounts ONE `RestApiPlugin` on its host kernel, and every environment's
 * services live on that environment's own kernel, handed out by the host's
 * `kernel-manager` and located by its `kernel-resolver`. The five providers
 * used to read `ctx.getService(slot)` on the host whatever environment they
 * were asked for, and the unscoped (hostname-routed) mount asked them for no
 * environment at all — so a hosted environment's approvals list answered `[]`
 * and a single request 501 (#29999).
 *
 * So this file boots that shape with REAL kernels: a host `ObjectKernel`
 * carrying the real plugin, and one `ObjectKernel` per environment, each
 * registering its own occupants through a plugin's `init` the way a real
 * composition does. An absent service is then the registry's own branded
 * "never registered" rejection, not a stub's `undefined`. The host carries an
 * occupant for every one of the five slots too, tagged `host`, so a request
 * answered by the host is SEEN, not merely absent.
 *
 * The identity is the unstubbed resolution against each environment's own
 * `auth` service, so the request is authenticated by the environment it is
 * aimed at. The one exception is the email door's capability (the send door
 * admits only `manage_platform_settings`): its case adds that one permission
 * to the context the real resolution produced, and nothing else.
 *
 * ## What each case pins
 *
 * Every downstream call records `{ env, op }`. A served request must record
 * exactly ONE call, from the target environment — never from the host, never
 * from the other environment — and answer that environment's row. An
 * environment whose kernel carries none of the five answers each door's own
 * "not configured" reply, and still records nothing: the host's occupant is
 * not a fallback.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { EMAIL_SEND_CAPABILITY } from './email-routes.js';

const captured = vi.hoisted(() => ({ servers: [] as any[] }));

// The plugin builds its `RestServer` inside `start()`, and nothing hands the
// instance out. The double EXTENDS the real class and only remembers it, so
// every route and resolution stays the production one; the email case needs
// the instance to grant its one capability.
vi.mock('./rest-server.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./rest-server.js')>();
    return {
        ...actual,
        RestServer: class extends actual.RestServer {
            constructor(...args: unknown[]) {
                super(...(args as ConstructorParameters<typeof actual.RestServer>));
                captured.servers.push(this);
            }
        },
    };
});

const { createRestApiPlugin } = await import('./rest-api-plugin.js');

const BASE = '/api/v1';
const SCOPED = `${BASE}/environments/:environmentId`;

const ENV_A = 'env_alpha';
const ENV_B = 'env_beta';
/** An environment whose kernel carries NONE of the five services. */
const ENV_BARE = 'env_bare';

/** Which hostname the host's resolver maps to which environment. */
const HOSTS: Record<string, string> = {
    'alpha.example.test': ENV_A,
    'beta.example.test': ENV_B,
    'bare.example.test': ENV_BARE,
};
const HOST_OF: Record<string, string> = Object.fromEntries(Object.entries(HOSTS).map(([h, e]) => [e, h]));

interface Reached { env: string; op: string }

/** The five occupants, each recording which kernel's instance answered. */
function occupants(env: string, reached: Reached[]): Record<string, unknown> {
    const rec = <T>(op: string, answer: T) => async (..._args: unknown[]): Promise<T> => {
        reached.push({ env, op });
        return answer;
    };
    return {
        approvals: {
            listRequests: rec('approvals.listRequests', [{ id: `areq_${env}`, status: 'pending' }]),
            getRequest: async (id: string) => {
                reached.push({ env, op: 'approvals.getRequest' });
                return id === `areq_${env}` ? { id, status: 'pending' } : null;
            },
        },
        sharing: { listShares: rec('sharing.listShares', [{ id: `share_${env}` }]) },
        sharingRules: { listRules: rec('sharingRules.listRules', [{ name: `rule_${env}` }]) },
        email: { send: rec('email.send', { status: 'sent', messageId: `mail_${env}` }) },
        analytics: { queryDataset: rec('analytics.queryDataset', { rows: [{ env }], fields: [] }) },
    };
}

/** Every identity lookup answers EMPTY: the principal is the session's user, no roles. */
function emptyQl(): unknown {
    const empty = async () => [];
    return new Proxy({}, { get: (_t, k: string) => (k === 'then' ? undefined : empty) });
}

function authServiceFor(userId: string): unknown {
    return {
        api: {
            getSession: async () => ({ user: { id: userId, email: `${userId}@example.test` }, session: { userId } }),
        },
    };
}

/** A protocol for the record page: no exposure policy, and the record exists. */
function envProtocol(env: string): unknown {
    return {
        getMetaItem: async () => undefined,
        getMetaItems: async () => ({ items: [] }),
        getData: async ({ object, id }: { object: string; id: string }) => ({ object, id, record: { id, env } }),
        findData: async () => ({ records: [], total: 0 }),
    };
}

async function bootKernel(name: string, services: Record<string, unknown>, extra: unknown[] = []): Promise<ObjectKernel> {
    const kernel = new ObjectKernel({ logger: { level: 'error' }, gracefulShutdown: false, skipSystemValidation: true } as any);
    await kernel.use({
        name,
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            for (const [slot, occupant] of Object.entries(services)) ctx.registerService(slot, occupant);
        },
    });
    for (const plugin of extra) await kernel.use(plugin as any);
    await kernel.bootstrap();
    return kernel;
}

type Handler = (req: any, res: any) => unknown;

function recordingHttp() {
    const table = new Map<string, Handler>();
    const on = (m: string) => (p: string, h: Handler) => { table.set(`${m} ${p}`, h); };
    return {
        table,
        get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
        use: () => {}, listen: async () => {}, close: async () => {},
    };
}

/**
 * The host's kernel manager, shaped like the real one where it matters here:
 * a cached kernel is handed back as is, and concurrent callers of a cold
 * environment share ONE build (the real manager's `pending` map). `builds`
 * counts builds, `acquisitions` counts calls.
 */
function hostKernelManager(kernels: Record<string, ObjectKernel>) {
    const acquisitions: string[] = [];
    const builds: string[] = [];
    const cache = new Map<string, ObjectKernel>();
    const pending = new Map<string, Promise<ObjectKernel>>();
    return {
        acquisitions,
        builds,
        reset() { acquisitions.length = 0; builds.length = 0; cache.clear(); pending.clear(); },
        async getOrCreate(environmentId: string): Promise<ObjectKernel> {
            acquisitions.push(environmentId);
            const hit = cache.get(environmentId);
            if (hit) return hit;
            let build = pending.get(environmentId);
            if (!build) {
                const kernel = kernels[environmentId];
                if (!kernel) throw new Error(`no such environment: ${environmentId}`);
                builds.push(environmentId);
                build = new Promise<ObjectKernel>((resolve) => setTimeout(() => resolve(kernel), 5));
                pending.set(environmentId, build);
                build.then((k) => { cache.set(environmentId, k); pending.delete(environmentId); });
            }
            return build;
        },
    };
}

/**
 * The host's ADR-0006 resolver: hostname → environment, and nothing for a
 * hostname no environment binds. `resolveKernel` (the acquisition API) is
 * spied so a path that buys a kernel to learn an id is seen.
 */
function hostKernelResolver() {
    const fromRequest = (context: any) => {
        const host = String(context?.request?.headers?.host ?? '');
        const env = HOSTS[host];
        if (env) context.environmentId = env;
    };
    return {
        resolveEnvironment: vi.fn(async (context: any) => { fromRequest(context); }),
        resolveKernel: vi.fn(async (context: any) => { fromRequest(context); return undefined; }),
    };
}

interface Hosted {
    table: Map<string, Handler>;
    reached: Reached[];
    km: ReturnType<typeof hostKernelManager>;
    resolver: ReturnType<typeof hostKernelResolver>;
    server: any;
    kernels: ObjectKernel[];
}

async function bootHosted(): Promise<Hosted> {
    const reached: Reached[] = [];
    const envKernel = (env: string, withServices: boolean) => bootKernel(`test.env.${env}`, {
        auth: authServiceFor(`u_${env}`),
        objectql: emptyQl(),
        protocol: envProtocol(env),
        ...(withServices ? occupants(env, reached) : {}),
    });
    const kernelsById: Record<string, ObjectKernel> = {
        [ENV_A]: await envKernel(ENV_A, true),
        [ENV_B]: await envKernel(ENV_B, true),
        [ENV_BARE]: await envKernel(ENV_BARE, false),
    };
    const km = hostKernelManager(kernelsById);
    const resolver = hostKernelResolver();
    const http = recordingHttp();
    captured.servers.length = 0;
    const host = await bootKernel('test.host.wiring', {
        'http.server': http,
        protocol: envProtocol('host'),
        'kernel-manager': km,
        'kernel-resolver': resolver,
        // The host's OWN occupants of all five slots: a request answered here
        // records `host`, which no case below may ever see.
        ...occupants('host', reached),
    }, [createRestApiPlugin({ api: { api: { enableProjectScoping: true, projectResolution: 'auto' } } } as any)]);
    expect(captured.servers, 'the plugin must construct exactly one RestServer').toHaveLength(1);
    return {
        table: http.table,
        reached,
        km,
        resolver,
        server: captured.servers[0],
        kernels: [host, ...Object.values(kernelsById)],
    };
}

type Mount = 'scoped' | 'hostname';

interface Door {
    provider: string;
    method: 'GET' | 'POST';
    /** Path below the base, scoped or unscoped. */
    path: string;
    params: (env: string) => Record<string, string>;
    body?: unknown;
    /** The downstream call serving the request makes. */
    op: string;
    /** What the served answer says about which environment answered. */
    answeredBy: (body: any) => unknown;
    /** The door's own answer when the environment carries no such service. */
    absent: { status: number; body?: unknown };
    /** The send door's capability, added to the real context. */
    needsEmailCapability?: boolean;
}

const INLINE_DATASET = {
    name: 'sales', label: 'Sales', object: 'opportunity',
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

const DOORS: Door[] = [
    {
        provider: 'approvals', method: 'GET', path: '/approvals/requests', params: () => ({}),
        op: 'approvals.listRequests', answeredBy: (b) => b?.data?.[0]?.id,
        // The list's documented absent answer: an empty list, so badge polls on
        // deployments without approvals stay quiet.
        absent: { status: 200, body: { data: [] } },
    },
    {
        provider: 'approvals', method: 'GET', path: '/approvals/requests/:id', params: (env) => ({ id: `areq_${env}` }),
        op: 'approvals.getRequest', answeredBy: (b) => b?.id,
        absent: { status: 501 },
    },
    {
        provider: 'sharing', method: 'GET', path: '/data/:object/:id/shares', params: () => ({ object: 'account', id: 'r1' }),
        op: 'sharing.listShares', answeredBy: (b) => b?.data?.[0]?.id,
        absent: { status: 501 },
    },
    {
        provider: 'sharingRules', method: 'GET', path: '/sharing/rules', params: () => ({}),
        op: 'sharingRules.listRules', answeredBy: (b) => b?.data?.[0]?.name,
        absent: { status: 501 },
    },
    {
        provider: 'email', method: 'POST', path: '/email/send', params: () => ({}),
        body: { to: 'someone@example.org', subject: 'Hello', text: 'body' },
        op: 'email.send', answeredBy: (b) => b?.messageId,
        absent: { status: 501 }, needsEmailCapability: true,
    },
    {
        provider: 'analytics', method: 'POST', path: '/analytics/dataset/query', params: () => ({}),
        body: { dataset: INLINE_DATASET, selection: { dimensions: ['region'], measures: ['revenue'] } },
        op: 'analytics.queryDataset', answeredBy: (b) => b?.rows?.[0]?.env,
        absent: { status: 501 },
    },
    {
        // The record page's approvals part reads the same provider.
        provider: 'approvals (record page)', method: 'POST', path: '/data/:object/:id/page',
        params: () => ({ object: 'account', id: 'r1' }), body: { approvals: true },
        op: 'approvals.listRequests', answeredBy: (b) => b?.data?.approvals?.requests?.[0]?.id,
        absent: { status: 200 },
    },
];

/** What a served door's body names, per environment. */
const EXPECTED_ANSWER: Record<string, (env: string) => unknown> = {
    'approvals.listRequests': (env) => `areq_${env}`,
    'approvals.getRequest': (env) => `areq_${env}`,
    'sharing.listShares': (env) => `share_${env}`,
    'sharingRules.listRules': (env) => `rule_${env}`,
    'email.send': (env) => `mail_${env}`,
    'analytics.queryDataset': (env) => env,
};

async function drive(h: Hosted, door: Door, mount: Mount, env: string) {
    const key = `${door.method} ${mount === 'scoped' ? SCOPED : BASE}${door.path}`;
    const handler = h.table.get(key);
    if (!handler) throw new Error(`route not mounted: ${key}`);
    const params = door.params(env);
    const concrete = door.path.replace(/:(\w+)/g, (_m, k: string) => params[k] ?? `:${k}`);
    const url = mount === 'scoped' ? `${BASE}/environments/${env}${concrete}` : `${BASE}${concrete}`;
    const req: any = {
        method: door.method,
        path: url,
        url,
        params: { ...params, ...(mount === 'scoped' ? { environmentId: env } : {}) },
        query: {},
        body: door.body,
        headers: {
            // A scoped request comes from a hostname no environment binds, so
            // the scoped id is the only thing naming the environment.
            host: mount === 'scoped' ? 'unbound.example.test' : HOST_OF[env],
            cookie: 'session=whatever',
        },
    };
    let status = 0; let body: any; let sent = false;
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: any) { body = b; sent = true; return res; },
        send() { sent = true; return res; }, header() { return res; }, setHeader() { return res; },
        end() { sent = true; }, write() { return true; }, type() { return res; },
    };
    await handler(req, res);
    return { status: status || (sent ? 200 : 0), body };
}

/** Grant the send door's one capability on top of the REAL resolved context. */
function withEmailCapability(h: Hosted): () => void {
    const server = h.server;
    const real = server.resolveExecCtx.bind(server);
    server.resolveExecCtx = async (environmentId: string | undefined, req: any) => {
        const ctx = await real(environmentId, req);
        return ctx ? { ...ctx, systemPermissions: [...(ctx.systemPermissions ?? []), EMAIL_SEND_CAPABILITY] } : ctx;
    };
    return () => { server.resolveExecCtx = real; };
}

describe('[#30011] hosted shape: two environment kernels behind one host REST plugin', () => {
    let h: Hosted;
    beforeAll(async () => { h = await bootHosted(); }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    for (const door of DOORS) {
        for (const mount of ['scoped', 'hostname'] as const) {
            for (const env of [ENV_A, ENV_B]) {
                it(`⭐ ${door.provider} (${door.method} ${door.path}, ${mount}) for ${env} is answered by ${env}'s service alone`, async () => {
                    h.reached.length = 0;
                    const restore = door.needsEmailCapability ? withEmailCapability(h) : () => {};
                    try {
                        const out = await drive(h, door, mount, env);
                        expect(out.status, JSON.stringify(out.body)).toBe(200);
                        expect(door.answeredBy(out.body)).toBe(EXPECTED_ANSWER[door.op]!(env));
                        // Exactly one downstream call, and it is the target's:
                        // not the host's, not the other environment's.
                        expect(h.reached.filter((r) => r.op === door.op)).toEqual([{ env, op: door.op }]);
                        expect(h.reached.filter((r) => r.env !== env)).toEqual([]);
                    } finally { restore(); }
                }, 60_000);
            }

            it(`${door.provider} (${mount}) for an environment carrying no such service gets the door's own answer — the host's is NOT a fallback`, async () => {
                h.reached.length = 0;
                const restore = door.needsEmailCapability ? withEmailCapability(h) : () => {};
                try {
                    const out = await drive(h, door, mount, ENV_BARE);
                    expect(out.status, JSON.stringify(out.body)).toBe(door.absent.status);
                    if (door.absent.body !== undefined) expect(out.body).toEqual(door.absent.body);
                    if (door.provider === 'approvals (record page)') {
                        // The part's documented absent answer: no requests, no lock.
                        expect(out.body?.data?.approvals).toEqual({ requests: [], lock: null });
                    }
                    expect(h.reached).toEqual([]);
                } finally { restore(); }
            }, 60_000);
        }
    }

    it('approvals: environment A\'s pending request is not readable through environment B', async () => {
        h.reached.length = 0;
        const door = DOORS[1]!;
        for (const mount of ['scoped', 'hostname'] as const) {
            const handler = h.table.get(`GET ${mount === 'scoped' ? SCOPED : BASE}${door.path}`)!;
            let status = 0;
            const res: any = { status(c: number) { status = c; return res; }, json() { return res; }, setHeader() { return res; } };
            await handler({
                method: 'GET', url: '', path: '', query: {},
                params: { id: `areq_${ENV_A}`, ...(mount === 'scoped' ? { environmentId: ENV_B } : {}) },
                headers: { host: mount === 'scoped' ? 'unbound.example.test' : HOST_OF[ENV_B], cookie: 'session=whatever' },
            }, res);
            // B's service was asked, and B holds no such request.
            expect(status).toBe(404);
        }
        expect(h.reached).toEqual([
            { env: ENV_B, op: 'approvals.getRequest' },
            { env: ENV_B, op: 'approvals.getRequest' },
        ]);
    }, 60_000);

    it('no kernel is bought to learn an environment id, and a cold environment is built once per request', async () => {
        h.resolver.resolveKernel.mockClear();
        h.resolver.resolveEnvironment.mockClear();
        h.km.reset();
        h.reached.length = 0;

        const out = await drive(h, DOORS[0]!, 'hostname', ENV_A);

        expect(out.status).toBe(200);
        expect(h.resolver.resolveKernel).not.toHaveBeenCalled();
        expect(h.resolver.resolveEnvironment).toHaveBeenCalled();
        // A cold environment is BUILT once for the request, however many
        // seams on its path ask the manager for it, and no other environment
        // is touched.
        expect(h.km.builds).toEqual([ENV_A]);
        expect(new Set(h.km.acquisitions)).toEqual(new Set([ENV_A]));
    }, 60_000);
});

describe('[#30011] single kernel: the same doors read the plugin\'s own kernel, exactly as before', () => {
    // The self-hosted composition: no `kernel-manager`, no `kernel-resolver`,
    // every service on the one kernel the REST plugin is mounted on. Scoping
    // is switched on so the scoped mount is driven too — an id on that mount
    // names no other kernel here, and the answer must not move.
    let h: Hosted;
    beforeAll(async () => {
        const reached: Reached[] = [];
        const http = recordingHttp();
        captured.servers.length = 0;
        const kernel = await bootKernel('test.single.wiring', {
            'http.server': http,
            protocol: envProtocol('host'),
            auth: authServiceFor('u_host'),
            objectql: emptyQl(),
            ...occupants('host', reached),
        }, [createRestApiPlugin({ api: { api: { enableProjectScoping: true, projectResolution: 'auto' } } } as any)]);
        expect(captured.servers).toHaveLength(1);
        h = {
            table: http.table,
            reached,
            km: hostKernelManager({}),
            resolver: hostKernelResolver(),
            server: captured.servers[0],
            kernels: [kernel],
        };
    }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    for (const door of DOORS) {
        for (const mount of ['scoped', 'hostname'] as const) {
            it(`${door.provider} (${door.method} ${door.path}, ${mount}) is answered by the one kernel's service`, async () => {
                h.reached.length = 0;
                const restore = door.needsEmailCapability ? withEmailCapability(h) : () => {};
                try {
                    // `host` is the tag of the one kernel's occupants; the ids
                    // the doors read are the same rows the hosted cases name.
                    const out = await drive(h, { ...door, params: () => door.params('host') }, mount, 'host');
                    expect(out.status, JSON.stringify(out.body)).toBe(200);
                    expect(door.answeredBy(out.body)).toBe(EXPECTED_ANSWER[door.op]!('host'));
                    expect(h.reached.filter((r) => r.op === door.op)).toEqual([{ env: 'host', op: door.op }]);
                } finally { restore(); }
            }, 60_000);
        }
    }
});
