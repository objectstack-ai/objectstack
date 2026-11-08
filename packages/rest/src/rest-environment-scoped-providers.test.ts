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
 *
 * ## [#30192] The sixth door, and the audited seams
 *
 * The `security` seam joined the five: the suggested-binding list and confirm
 * (ADR-0090 D5/D9) and `security/explain` (D6) are driven through the same
 * matrix as DOORS rows, so a hosted owner can accept an installed app's default
 * permission set. The last describe pins the seams #30192 audited on the same
 * shape — `auth`, `settings`, `i18n`, `metadata`, and `security` as the record
 * and meta doors reach it — with the host carrying its own occupant of each,
 * so an answer from the host is seen.
 *
 * ## [#30218] The data engine
 *
 * The `objectql` engine was the last environment-blind provider. The last two
 * describes boot the same shape with the host carrying an engine of its OWN,
 * and drive the four doors that ask the provider for one: the transactional
 * `POST /batch`, the `/meta` object-state and published reads, and the meta
 * read gate's disabled-package owner step. Every engine call records which
 * kernel's engine made it, so a batch for environment A is seen to open its
 * transaction and write through A's engine alone, never B's or the host's.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { EMAIL_SEND_CAPABILITY } from './email-routes.js';
// Pays `@objectstack/objectql`'s first load at collection, never inside a clocked case
// (the route modules import it lazily).
import '@objectstack/objectql';

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
/** [#30192] An environment whose kernel carries no `auth` service either. */
const ENV_NOAUTH = 'env_noauth';

/**
 * The environments of the last describe, by how their kernel answers the
 * `security` slot: a healthy occupant; none at all; a registered factory that
 * throws; an acquisition that rejects at the security step; and a kernel no
 * acquisition reaches.
 */
const ENV_SEC_OK = 'env_sec_ok';
const ENV_SEC_NONE = 'env_sec_none';
const ENV_SEC_FACTORY = 'env_sec_factory';
const ENV_SEC_ACQ = 'env_sec_acq';
const ENV_SEC_DOWN = 'env_sec_down';

/** Which hostname the host's resolver maps to which environment. */
const HOSTS: Record<string, string> = {
    'alpha.example.test': ENV_A,
    'beta.example.test': ENV_B,
    'bare.example.test': ENV_BARE,
    'noauth.example.test': ENV_NOAUTH,
    'sec-ok.example.test': ENV_SEC_OK,
    'sec-none.example.test': ENV_SEC_NONE,
    'sec-factory.example.test': ENV_SEC_FACTORY,
    'sec-acq.example.test': ENV_SEC_ACQ,
    'sec-down.example.test': ENV_SEC_DOWN,
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
        // [#30192] plugin-security's `security` service, as the three doors
        // below call it: a suggestion is confirmable only where it was made.
        security: {
            listAudienceBindingSuggestions: rec('security.listAudienceBindingSuggestions', [
                { id: `sugg_${env}`, permissionSet: 'crm_user', packageId: 'app.objectstack.hotcrm', status: 'pending' },
            ]),
            confirmAudienceBindingSuggestion: async (_ctx: unknown, id: string) => {
                reached.push({ env, op: 'security.confirmAudienceBindingSuggestion' });
                if (id !== `sugg_${env}`) {
                    throw Object.assign(new Error(`No audience-binding suggestion '${id}'.`), {
                        statusCode: 404, code: 'SUGGESTION_NOT_FOUND',
                    });
                }
                return { id, status: 'accepted' };
            },
            dismissAudienceBindingSuggestion: rec('security.dismissAudienceBindingSuggestion', {}),
            explain: rec('security.explain', { env, allowed: true }),
        },
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

interface HostedOptions {
    /** [#30192] More occupants for the host and for each serving environment. */
    extra?: (env: string) => Record<string, unknown>;
    /** [#30192] The host carries an `auth` of its own (a `u_host` session). */
    hostAuth?: boolean;
    /** [#30218] `ENV_BARE`'s kernel carries no `objectql` engine at all. */
    bareWithoutEngine?: boolean;
}

async function bootHosted(opts: HostedOptions = {}): Promise<Hosted> {
    const reached: Reached[] = [];
    const envKernel = (env: string, withServices: boolean, withAuth = true) => bootKernel(`test.env.${env}`, {
        ...(withAuth ? { auth: authServiceFor(`u_${env}`) } : {}),
        ...(opts.bareWithoutEngine && env === ENV_BARE ? {} : { objectql: emptyQl() }),
        protocol: envProtocol(env),
        ...(withServices ? { ...occupants(env, reached), ...opts.extra?.(env) } : {}),
    });
    const kernelsById: Record<string, ObjectKernel> = {
        [ENV_A]: await envKernel(ENV_A, true),
        [ENV_B]: await envKernel(ENV_B, true),
        [ENV_BARE]: await envKernel(ENV_BARE, false),
        [ENV_NOAUTH]: await envKernel(ENV_NOAUTH, false, false),
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
        ...opts.extra?.('host'),
        ...(opts.hostAuth ? { auth: authServiceFor('u_host') } : {}),
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
    /** The query string, for a door that reads one. */
    query?: Record<string, string>;
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
    {
        // [#30192] The ADR-0090 D5/D9 suggestion list an owner reviews.
        provider: 'security', method: 'GET', path: '/security/suggested-bindings', params: () => ({}),
        op: 'security.listAudienceBindingSuggestions', answeredBy: (b) => b?.data?.[0]?.id,
        absent: { status: 501 },
    },
    {
        // [#30192] …and the accept that gives every member the app's set.
        provider: 'security', method: 'POST', path: '/security/suggested-bindings/:id/confirm',
        params: (env) => ({ id: `sugg_${env}` }),
        op: 'security.confirmAudienceBindingSuggestion', answeredBy: (b) => b?.data?.id,
        absent: { status: 501 },
    },
    {
        // [#30192] The D6 access explanation the list row menu reads.
        provider: 'security', method: 'GET', path: '/security/explain', params: () => ({}),
        query: { object: 'account', operation: 'read' },
        op: 'security.explain', answeredBy: (b) => b?.env,
        absent: { status: 501 },
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
    'security.listAudienceBindingSuggestions': (env) => `sugg_${env}`,
    'security.confirmAudienceBindingSuggestion': (env) => `sugg_${env}`,
    'security.explain': (env) => env,
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
        query: { ...door.query },
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

    it('[#30192] security: environment A\'s suggestion cannot be confirmed through environment B', async () => {
        h.reached.length = 0;
        const door = DOORS.find((d) => d.op === 'security.confirmAudienceBindingSuggestion')!;
        for (const mount of ['scoped', 'hostname'] as const) {
            const handler = h.table.get(`POST ${mount === 'scoped' ? SCOPED : BASE}${door.path}`)!;
            let status = 0; let body: any;
            const res: any = {
                status(c: number) { status = c; return res; },
                json(b: any) { body = b; return res; },
                setHeader() { return res; },
            };
            await handler({
                method: 'POST', url: '', path: '', query: {}, body: {},
                params: { id: `sugg_${ENV_A}`, ...(mount === 'scoped' ? { environmentId: ENV_B } : {}) },
                headers: { host: mount === 'scoped' ? 'unbound.example.test' : HOST_OF[ENV_B], cookie: 'session=whatever' },
            }, res);
            // B's service was asked, and B made no such suggestion.
            expect(status, JSON.stringify(body)).toBe(404);
            expect(body?.error?.code).toBe('SUGGESTION_NOT_FOUND');
        }
        expect(h.reached).toEqual([
            { env: ENV_B, op: 'security.confirmAudienceBindingSuggestion' },
            { env: ENV_B, op: 'security.confirmAudienceBindingSuggestion' },
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

/**
 * [#30192] The seams #30192 audited, on the hosted shape, each pinned at the
 * `RestServer` seam its routes call. The host carries its OWN occupant of every
 * one of them — its own `auth` (a `u_host` session), `settings` (its own time
 * zone), `i18n` and `metadata` — so an answer from the host is seen, not merely
 * absent. `ENV_BARE` carries none of the four but `auth`; `ENV_NOAUTH` carries
 * no `auth` either.
 */
const TIME_ZONES: Record<string, string> = {
    [ENV_A]: 'Asia/Tokyo',
    [ENV_B]: 'Europe/Paris',
    host: 'America/New_York',
};

function auditedOccupants(env: string): Record<string, unknown> {
    return {
        settings: {
            get: async (namespace: string, key: string) => ({
                value: namespace === 'localization' && key === 'timezone' ? TIME_ZONES[env] : undefined,
            }),
        },
        i18n: { __env: env, t: (key: string) => key },
        metadata: { __env: env },
    };
}

/** A request routed by hostname alone, as a hosted environment's browser sends it. */
function hostnameRequest(env: string): any {
    return {
        method: 'GET', url: `${BASE}/probe`, path: `${BASE}/probe`, params: {}, query: {},
        headers: { host: HOST_OF[env], cookie: 'session=whatever' },
    };
}

/** The same request on the scoped mount, from a hostname no environment binds. */
function scopedRequest(env: string): any {
    return {
        method: 'GET', url: `${BASE}/environments/${env}/probe`, path: `${BASE}/environments/${env}/probe`,
        params: { environmentId: env }, query: {},
        headers: { host: 'unbound.example.test', cookie: 'session=whatever' },
    };
}

describe('[#30192] hosted shape: the audited seams answer from the request\'s environment, never the host', () => {
    let h: Hosted;
    beforeAll(async () => { h = await bootHosted({ extra: auditedOccupants, hostAuth: true }); }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    it('auth: an environment whose kernel carries no auth authenticates nobody — the host\'s session is not its identity', async () => {
        // The control: an environment with its own auth is the identity that answers.
        const served = await h.server.resolveExecCtx(undefined, hostnameRequest(ENV_A));
        expect(served?.userId).toBe(`u_${ENV_A}`);
        for (const req of [hostnameRequest(ENV_NOAUTH), scopedRequest(ENV_NOAUTH)]) {
            const ctx = await h.server.resolveExecCtx(req.params.environmentId, req);
            expect(ctx?.userId, 'the host\'s identity store answered for the environment').toBeUndefined();
            expect(ctx).toBeUndefined();
        }
    }, 60_000);

    it('settings: the execution context localizes from the request\'s environment\'s settings, never the host\'s', async () => {
        for (const env of [ENV_A, ENV_B]) {
            for (const req of [hostnameRequest(env), scopedRequest(env)]) {
                const ctx = await h.server.resolveExecCtx(req.params.environmentId, req);
                expect(ctx?.userId).toBe(`u_${env}`);
                expect(ctx?.timezone, `${env} (${req.params.environmentId ? 'scoped' : 'hostname'})`).toBe(TIME_ZONES[env]);
            }
        }
        // An environment with no settings service of its own reads the default,
        // not the host's reference time zone.
        const bare = await h.server.resolveExecCtx(undefined, hostnameRequest(ENV_BARE));
        expect(bare?.userId).toBe(`u_${ENV_BARE}`);
        expect(bare?.timezone).not.toBe(TIME_ZONES.host);
    }, 60_000);

    it('i18n and metadata: an environment\'s own occupant answers, and the host\'s is not a fallback', async () => {
        for (const env of [ENV_A, ENV_B]) {
            for (const req of [hostnameRequest(env), scopedRequest(env)]) {
                expect((await h.server.resolveI18nService(req.params.environmentId, req))?.__env).toBe(env);
                expect((await h.server.resolveMetadataService(req.params.environmentId, req) as any)?.__env).toBe(env);
            }
        }
        for (const req of [hostnameRequest(ENV_BARE), scopedRequest(ENV_BARE)]) {
            expect(await h.server.resolveI18nService(req.params.environmentId, req)).toBeUndefined();
            expect(await h.server.resolveMetadataService(req.params.environmentId, req)).toBeUndefined();
        }
    }, 60_000);

    it('security: the record, export and meta doors reach the request\'s environment\'s service, and the host\'s is not a fallback', async () => {
        for (const env of [ENV_A, ENV_B]) {
            for (const req of [hostnameRequest(env), scopedRequest(env)]) {
                const id = req.params.environmentId;
                const viaServer = await h.server.resolveSecurityService(id, req);
                const viaMetaGate = await h.server.metaReadAudienceSources(id, req).resolveSecurityService();
                h.reached.length = 0;
                await viaServer?.explain?.({}, {});
                await viaMetaGate?.explain?.({}, {});
                expect(h.reached).toEqual([{ env, op: 'security.explain' }, { env, op: 'security.explain' }]);
            }
        }
        for (const req of [hostnameRequest(ENV_BARE), scopedRequest(ENV_BARE)]) {
            const id = req.params.environmentId;
            expect(await h.server.resolveSecurityService(id, req)).toBeUndefined();
            expect(await h.server.metaReadAudienceSources(id, req).resolveSecurityService()).toBeUndefined();
        }
    }, 60_000);
});

/**
 * [#30218] The engine each kernel carries in the last two describes. Every
 * call a door makes records the kernel whose engine answered (`env`) and, for
 * a write, the transaction it joined (`trx`), so a write that reached another
 * kernel's store, or joined another kernel's transaction, is seen. Identity
 * lookups the execution context makes answer empty, as `emptyQl` does.
 *
 * The registry knows ONE object, `acct_<env>`, and disables ONE package,
 * `pkg_<env>`, so a read judged by another kernel's registry answers
 * differently on the wire as well as in the record.
 */
interface EngineCall { env: string; op: string; trx?: string }

function recordingEngine(env: string, calls: EngineCall[]): unknown {
    const empty = async () => [];
    const own: Record<string, unknown> = {
        registry: {
            getObject: (name: string) => {
                calls.push({ env, op: 'registry.getObject' });
                return name === `acct_${env}` ? { name, fields: {} } : undefined;
            },
            isObjectPackageDisabled: () => false,
            isPackageDisabled: (packageId: unknown) => {
                calls.push({ env, op: 'registry.isPackageDisabled' });
                return packageId === `pkg_${env}`;
            },
        },
        transaction: async (fn: (trx: unknown) => unknown) => {
            calls.push({ env, op: 'transaction' });
            return fn({ __trx: env });
        },
        update: async (_object: string, data: any, options: any) => {
            assertEngineUpdateDispatch(data, options);
            calls.push({ env, op: 'update', trx: options?.context?.__trx });
            return { id: data?.id, env };
        },
        delete: async (_object: string, options: any) => {
            assertEngineDeleteDispatch(options);
            calls.push({ env, op: 'delete', trx: options?.context?.__trx });
            return { id: options?.where?.id, env };
        },
    };
    return new Proxy(own, { get: (t, k: string) => (k === 'then' ? undefined : k in t ? t[k] : empty) });
}

/** A `metadata` service with the code/package store the published read falls back to. */
function publishedStore(env: string): unknown {
    return { getPublished: async (type: string, name: string) => ({ type, name, env }) };
}

/**
 * The environment's protocol, with the create ingress the batch's create op
 * goes through, recording the transaction the create joined. An item that is
 * not an object names its owner package, `pkg_<env>`.
 */
function engineProtocol(env: string, calls: EngineCall[]): unknown {
    return {
        ...(envProtocol(env) as Record<string, unknown>),
        getMetaItem: async (request: { type?: string }) => (request?.type === 'object' ? undefined : { packageId: `pkg_${env}` }),
        createData: async ({ object, data, context }: { object: string; data: any; context: any }) => {
            calls.push({ env, op: 'protocol.createData', trx: context?.__trx });
            return { object, record: { id: `new_${env}`, ...data } };
        },
    };
}

/** The batch every case sends: one create, one update, one delete. */
const BATCH_BODY = {
    operations: [
        { object: 'account', action: 'create', data: { name: 'Acme' } },
        { object: 'account', action: 'update', id: 'r1', data: { name: 'Acme 2' } },
        { object: 'account', action: 'delete', id: 'r2' },
    ],
};

const ENGINE_DOORS: Record<'batch' | 'state' | 'published', Door> = {
    batch: {
        provider: 'objectql', method: 'POST', path: '/batch', params: () => ({}), body: BATCH_BODY,
        op: 'transaction', answeredBy: (b) => b?.results?.map((r: any) => r?.id ?? r?.env),
        absent: { status: 501 },
    },
    state: {
        provider: 'objectql', method: 'GET', path: '/meta/object/:name/state/:field',
        params: (env) => ({ name: `acct_${env}`, field: 'status' }),
        op: 'registry.getObject', answeredBy: (b) => b?.object,
        absent: { status: 404 },
    },
    published: {
        provider: 'objectql', method: 'GET', path: '/meta/:type/:name/published',
        params: () => ({ type: 'view', name: 'v_list' }),
        op: 'registry.isPackageDisabled', answeredBy: (b) => b,
        absent: { status: 404 },
    },
};

/** The batch's engine calls, in order, all made by `env`'s engine and in `env`'s transaction. */
function batchCalls(env: string): EngineCall[] {
    return [
        { env, op: 'transaction' },
        { env, op: 'protocol.createData', trx: env },
        { env, op: 'update', trx: env },
        { env, op: 'delete', trx: env },
    ];
}

const BATCH_OPS = new Set(['transaction', 'protocol.createData', 'update', 'delete']);

/** A protocol for the meta read gate's owner step: the plain read serves no item, and names `pkg_<env>`. */
function ownerStepProtocol(env: string): any {
    return { getMetaItem: async () => ({ item: undefined, packageId: `pkg_${env}` }) };
}

describe('[#30218] hosted shape: the data engine is the request\'s environment\'s, never the host\'s', () => {
    let h: Hosted;
    const calls: EngineCall[] = [];
    beforeAll(async () => {
        h = await bootHosted({
            extra: (env) => ({
                objectql: recordingEngine(env, calls),
                protocol: engineProtocol(env, calls),
                metadata: publishedStore(env),
            }),
            bareWithoutEngine: true,
        });
    }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    for (const mount of ['scoped', 'hostname'] as const) {
        for (const env of [ENV_A, ENV_B]) {
            it(`⭐ POST /batch (${mount}) for ${env} opens its transaction and writes through ${env}'s engine alone`, async () => {
                calls.length = 0;
                const out = await drive(h, ENGINE_DOORS.batch, mount, env);
                expect(out.status, JSON.stringify(out.body)).toBe(200);
                expect(out.body?.results?.map((r: any) => r?.id)).toEqual([`new_${env}`, 'r1', 'r2']);
                expect(calls.filter((c) => BATCH_OPS.has(c.op))).toEqual(batchCalls(env));
                // Nothing at all went through the other environment's engine,
                // or the host's: no read, no transaction, no write.
                expect(calls.filter((c) => c.env !== env)).toEqual([]);
            }, 60_000);

            it(`GET /meta/object/:name/state/:field (${mount}) for ${env} is judged by ${env}'s engine registry`, async () => {
                calls.length = 0;
                const out = await drive(h, ENGINE_DOORS.state, mount, env);
                expect(out.status, JSON.stringify(out.body)).toBe(200);
                // `acct_<env>` is known to `env`'s registry alone.
                expect(out.body).toEqual({ object: `acct_${env}`, field: 'status', from: null, next: null });
                expect(calls.some((c) => c.op === 'registry.getObject')).toBe(true);
                expect(calls.filter((c) => c.env !== env)).toEqual([]);
            }, 60_000);

            it(`GET /meta/:type/:name/published (${mount}) for ${env} asks ${env}'s engine whether the owner package is disabled`, async () => {
                calls.length = 0;
                const out = await drive(h, ENGINE_DOORS.published, mount, env);
                // `pkg_<env>` is disabled on `env`'s registry alone, so the item
                // is withheld: the door's own 404. Any other kernel's registry
                // would have served the published document.
                expect(out.status, JSON.stringify(out.body)).toBe(404);
                expect(calls.filter((c) => c.op === 'registry.isPackageDisabled')).toEqual([{ env, op: 'registry.isPackageDisabled' }]);
                expect(calls.filter((c) => c.env !== env)).toEqual([]);
            }, 60_000);

            it(`the meta read gate's disabled-package owner step (${mount}) for ${env} asks ${env}'s engine`, async () => {
                const req = mount === 'scoped' ? scopedRequest(env) : hostnameRequest(env);
                calls.length = 0;
                const sources = h.server.metaItemReadGateSources(req.params.environmentId, req, ownerStepProtocol(env));
                await expect(sources.isItemOfDisabledPackage({ type: 'view', name: 'v_list' })).resolves.toBe(true);
                expect(calls).toEqual([{ env, op: 'registry.isPackageDisabled' }]);
            }, 60_000);
        }

        it(`POST /batch (${mount}) for an environment whose kernel carries no engine answers 501 — the host's engine is NOT a fallback`, async () => {
            calls.length = 0;
            const out = await drive(h, ENGINE_DOORS.batch, mount, ENV_BARE);
            expect(out.status, JSON.stringify(out.body)).toBe(501);
            expect(out.body?.code).toBe('NOT_IMPLEMENTED');
            expect(calls).toEqual([]);
        }, 60_000);
    }
});

describe('[#30218] single kernel: the data engine is the plugin\'s own kernel\'s, exactly as before', () => {
    let h: Hosted;
    const calls: EngineCall[] = [];
    beforeAll(async () => {
        const http = recordingHttp();
        captured.servers.length = 0;
        const kernel = await bootKernel('test.single.engine', {
            'http.server': http,
            protocol: engineProtocol('host', calls),
            auth: authServiceFor('u_host'),
            objectql: recordingEngine('host', calls),
            metadata: publishedStore('host'),
        }, [createRestApiPlugin({ api: { api: { enableProjectScoping: true, projectResolution: 'auto' } } } as any)]);
        expect(captured.servers).toHaveLength(1);
        h = {
            table: http.table,
            reached: [],
            km: hostKernelManager({}),
            resolver: hostKernelResolver(),
            server: captured.servers[0],
            kernels: [kernel],
        };
    }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    for (const mount of ['scoped', 'hostname'] as const) {
        it(`POST /batch (${mount}) runs in the one kernel's transaction`, async () => {
            calls.length = 0;
            const out = await drive(h, ENGINE_DOORS.batch, mount, 'host');
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(calls.filter((c) => BATCH_OPS.has(c.op))).toEqual(batchCalls('host'));
        }, 60_000);

        it(`GET /meta/object/:name/state/:field (${mount}) is judged by the one kernel's registry`, async () => {
            calls.length = 0;
            const out = await drive(h, ENGINE_DOORS.state, mount, 'host');
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(out.body?.object).toBe('acct_host');
        }, 60_000);

        it(`GET /meta/:type/:name/published (${mount}) asks the one kernel's registry`, async () => {
            calls.length = 0;
            const out = await drive(h, ENGINE_DOORS.published, mount, 'host');
            expect(out.status, JSON.stringify(out.body)).toBe(404);
            expect(calls.filter((c) => c.op === 'registry.isPackageDisabled')).toEqual([{ env: 'host', op: 'registry.isPackageDisabled' }]);
        }, 60_000);

        it(`the meta read gate's owner step (${mount}) asks the one kernel's registry`, async () => {
            const req = mount === 'scoped' ? scopedRequest('host') : hostnameRequest('host');
            calls.length = 0;
            const sources = h.server.metaItemReadGateSources(req.params.environmentId, req, ownerStepProtocol('host'));
            await expect(sources.isItemOfDisabledPackage({ type: 'view', name: 'v_list' })).resolves.toBe(true);
            expect(calls).toEqual([{ env: 'host', op: 'registry.isPackageDisabled' }]);
        }, 60_000);
    }
});

/**
 * A door whose environment's security service cannot be resolved refuses
 * rather than proceeds.
 *
 * The `security` slot answers one of two different facts, and the doors keep
 * them apart. NOT REGISTERED is a deployment with no permission posture at all
 * (ADR-0106 D6 tier 1): every door serves it exactly as before. REGISTERED BUT
 * UNRESOLVABLE is an unhealthy security service, which D6 tier 3 rules must
 * never open a door: the request answers the `503 SERVICE_UNAVAILABLE` an
 * unreadable authorization input answers, and nothing is served — no row, no
 * template, no schema.
 *
 * Four doors ask the server's one security resolver, each driven on both
 * mounts: the export, the import template's gate, the template's column
 * projection, and the object-schema mask of `GET /meta/object/:name`. Each
 * environment answers the slot one way:
 *
 *  - `ENV_SEC_OK` — a healthy occupant, the control: export and create are
 *    denied on `deal`, a `memo` template is projected to its writable columns,
 *    and `secret` is not a readable field;
 *  - `ENV_SEC_NONE` — no occupant: every door serves;
 *  - `ENV_SEC_FACTORY` — the slot is registered as a factory that throws;
 *  - `ENV_SEC_ACQ` — a healthy occupant whose kernel acquisition rejects at the
 *    security step, from the first step (or, for the projection leg, from the
 *    second, so the template's gate is answered and its projection is not);
 *  - `ENV_SEC_DOWN` — every acquisition rejects, so the request fails before
 *    any door asks, and serves nothing.
 *
 * Every fault is the production seam's own: the registry's rejection of a
 * factory that threw, or the kernel manager's rejection. The wrapper around
 * the server's security provider only chooses WHICH acquisition sees it; the
 * provider it calls is the plugin's.
 */
const POSTURE_FIELDS = {
    id: { type: 'text', label: 'ID' },
    name: { type: 'text', label: 'Name' },
    secret: { type: 'text', label: 'Secret' },
};
const POSTURE_OBJECTS: Record<string, { name: string; label: string; fields: typeof POSTURE_FIELDS }> = {
    deal: { name: 'deal', label: 'Deal', fields: POSTURE_FIELDS },
    memo: { name: 'memo', label: 'Memo', fields: POSTURE_FIELDS },
};

/** The environment's protocol: two objects, and a row read that records which kernel read it. */
function postureProtocol(env: string, reached: Reached[]): unknown {
    return {
        ...(envProtocol(env) as Record<string, unknown>),
        getMetaItem: async (request: { type?: string; name?: string }) => {
            const item = request?.type === 'object' ? POSTURE_OBJECTS[request?.name ?? ''] : undefined;
            return item ? { type: 'object', name: item.name, item } : undefined;
        },
        getMetaItems: async (request: { type?: string }) => ({
            items: request?.type === 'object' ? Object.values(POSTURE_OBJECTS) : [],
        }),
        findData: async ({ object }: { object: string }) => {
            reached.push({ env, op: 'findData' });
            return { object, records: [{ id: '1', name: `row_${env}`, secret: `secret_${env}` }] };
        },
    };
}

/** A healthy `security` occupant: export denied, create denied on `deal`, `secret` unreadable. */
function postureSecurity(env: string, reached: Reached[]): unknown {
    const rec = (op: string, answer: (...args: any[]) => unknown) => async (...args: any[]) => {
        reached.push({ env, op });
        return answer(...args);
    };
    return {
        canExport: rec('security.canExport', () => false),
        explain: rec('security.explain', (request: { object?: string }) => ({ allowed: request?.object === 'memo' })),
        getWritableFields: rec('security.getWritableFields', () => ['name']),
        getReadableFields: rec('security.getReadableFields', () => ['id', 'name']),
    };
}

/** The `security` slot registered as a factory that throws. */
const throwingSecurityFactory = {
    name: 'test.security.factory-throws',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
        ctx.registerServiceFactory('security', () => {
            throw new Error('the security service failed to construct');
        });
    },
};

interface PostureHosted extends Hosted {
    /** On `ENV_SEC_ACQ`, the security-step acquisitions of a request from `rejectFrom` on reject. */
    securityStep: { rejectFrom: number; count: number; rejecting: boolean };
}

async function bootSecurityPosture(): Promise<PostureHosted> {
    const reached: Reached[] = [];
    const envKernel = (env: string, security: 'occupant' | 'none' | 'factory-throws') => bootKernel(`test.env.${env}`, {
        auth: authServiceFor(`u_${env}`),
        objectql: emptyQl(),
        protocol: postureProtocol(env, reached),
        ...(security === 'occupant' ? { security: postureSecurity(env, reached) } : {}),
    }, security === 'factory-throws' ? [throwingSecurityFactory] : []);
    const kernelsById: Record<string, ObjectKernel> = {
        [ENV_SEC_OK]: await envKernel(ENV_SEC_OK, 'occupant'),
        [ENV_SEC_NONE]: await envKernel(ENV_SEC_NONE, 'none'),
        [ENV_SEC_FACTORY]: await envKernel(ENV_SEC_FACTORY, 'factory-throws'),
        [ENV_SEC_ACQ]: await envKernel(ENV_SEC_ACQ, 'occupant'),
    };
    const managed = hostKernelManager(kernelsById);
    const securityStep = { rejectFrom: 1, count: 0, rejecting: false };
    const km = {
        ...managed,
        async getOrCreate(environmentId: string): Promise<ObjectKernel> {
            if (environmentId === ENV_SEC_DOWN || (environmentId === ENV_SEC_ACQ && securityStep.rejecting)) {
                managed.acquisitions.push(environmentId);
                throw new Error(`the kernel of ${environmentId} could not be acquired`);
            }
            return managed.getOrCreate(environmentId);
        },
    };
    const resolver = hostKernelResolver();
    const http = recordingHttp();
    captured.servers.length = 0;
    const host = await bootKernel('test.host.security-posture', {
        'http.server': http,
        protocol: envProtocol('host'),
        'kernel-manager': km,
        'kernel-resolver': resolver,
        // The host's OWN occupant: an answer from it is recorded as `host`.
        security: postureSecurity('host', reached),
    }, [createRestApiPlugin({ api: { api: { enableProjectScoping: true, projectResolution: 'auto' } } } as any)]);
    expect(captured.servers, 'the plugin must construct exactly one RestServer').toHaveLength(1);
    const server = captured.servers[0];
    const provider = server.securityServiceProvider;
    expect(typeof provider, 'the plugin wires its environment-scoped security provider').toBe('function');
    // The provider's acquisition runs synchronously inside this call, so the
    // flag is up for exactly that one acquisition and no other.
    server.securityServiceProvider = (environmentId?: string) => {
        securityStep.count += 1;
        securityStep.rejecting = securityStep.count >= securityStep.rejectFrom;
        try { return provider(environmentId); } finally { securityStep.rejecting = false; }
    };
    return {
        table: http.table,
        reached,
        km: managed,
        resolver,
        server,
        kernels: [host, ...Object.values(kernelsById)],
        securityStep,
    };
}

interface PostureDoor {
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
}

const POSTURE_DOORS = {
    export: { path: '/data/:object/export', params: { object: 'deal' }, query: { format: 'csv' } },
    templateGate: { path: '/data/:object/export', params: { object: 'deal' }, query: { template: 'true' } },
    template: { path: '/data/:object/export', params: { object: 'memo' }, query: { template: 'true' } },
    mask: { path: '/meta/:type/:name', params: { type: 'object', name: 'deal' }, query: {} },
} satisfies Record<string, PostureDoor>;

async function drivePosture(h: PostureHosted, door: PostureDoor, mount: Mount, env: string, rejectFrom = 1) {
    h.securityStep.count = 0;
    h.securityStep.rejectFrom = rejectFrom;
    h.reached.length = 0;
    const key = `GET ${mount === 'scoped' ? SCOPED : BASE}${door.path}`;
    const handler = h.table.get(key);
    if (!handler) throw new Error(`route not mounted: ${key}`);
    const concrete = door.path.replace(/:(\w+)/g, (_m, k: string) => door.params[k] ?? `:${k}`);
    const url = mount === 'scoped' ? `${BASE}/environments/${env}${concrete}` : `${BASE}${concrete}`;
    const req: any = {
        method: 'GET',
        path: url,
        url,
        params: { ...door.params, ...(mount === 'scoped' ? { environmentId: env } : {}) },
        query: { ...door.query },
        headers: {
            host: mount === 'scoped' ? 'unbound.example.test' : HOST_OF[env],
            cookie: 'session=whatever',
        },
    };
    let status = 0; let body: any;
    const headers: Record<string, string> = {};
    const written: unknown[] = [];
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: any) { body = b; return res; },
        send(b: any) { body = b; return res; },
        header(n: string, v: string) { headers[n] = v; return res; },
        setHeader(n: string, v: string) { headers[n] = v; return res; },
        write(chunk: unknown) { written.push(chunk); return true; },
        end() {}, type() { return res; },
    };
    await handler(req, res);
    return { status: status || 200, body, headers, written };
}

/** The served schema's field names, in either served shape of `fields`. */
function servedFieldNames(body: any): string[] {
    const item = body?.data?.item ?? body?.item ?? body?.data;
    const fields = item?.fields;
    if (Array.isArray(fields)) return fields.map((f: any) => f?.name);
    return fields && typeof fields === 'object' ? Object.keys(fields) : [];
}

/**
 * The refusal: the declared outage, and not one byte of the door's payload.
 * The pair that is the contract is the STATUS and the machine CODE; the body is
 * the flat shape every withheld 5xx on this server wears.
 */
function expectUnresolvableRefusal(h: PostureHosted, out: Awaited<ReturnType<typeof drivePosture>>): void {
    expect(out.status, JSON.stringify(out.body)).toBe(503);
    expect(out.body?.code, JSON.stringify(out.body)).toBe('SERVICE_UNAVAILABLE');
    expect(out.written).toEqual([]);
    expect(h.reached.filter((r) => r.op === 'findData')).toEqual([]);
    expect(servedFieldNames(out.body)).toEqual([]);
}

const UNRESOLVABLE: Array<{ env: string; how: string }> = [
    { env: ENV_SEC_FACTORY, how: 'is registered as a factory that throws' },
    { env: ENV_SEC_ACQ, how: 'cannot be acquired at the security step' },
];

describe('a door whose environment\'s security service cannot be resolved refuses rather than proceeds', () => {
    let h: PostureHosted;
    beforeAll(async () => { h = await bootSecurityPosture(); }, 60_000);
    afterAll(async () => { for (const k of h?.kernels ?? []) await k.shutdown(); });

    for (const mount of ['scoped', 'hostname'] as const) {
        it(`control (${mount}): a healthy security service denies the export and the template, projects the template to its writable columns, and masks the schema`, async () => {
            const exported = await drivePosture(h, POSTURE_DOORS.export, mount, ENV_SEC_OK);
            expect(exported.status, JSON.stringify(exported.body)).toBe(403);
            expect(exported.body?.code).toBe('EXPORT_NOT_PERMITTED');
            expect(h.reached).toEqual([{ env: ENV_SEC_OK, op: 'security.canExport' }]);

            const gated = await drivePosture(h, POSTURE_DOORS.templateGate, mount, ENV_SEC_OK);
            expect(gated.status, JSON.stringify(gated.body)).toBe(403);
            expect(gated.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(gated.written).toEqual([]);

            const template = await drivePosture(h, POSTURE_DOORS.template, mount, ENV_SEC_OK);
            expect(template.status, JSON.stringify(template.body)).toBe(200);
            expect(template.headers['X-Export-Template-Projection']).toBe('writable');
            expect(template.written).toHaveLength(1);

            const schema = await drivePosture(h, POSTURE_DOORS.mask, mount, ENV_SEC_OK);
            expect(schema.status, JSON.stringify(schema.body)).toBe(200);
            expect(servedFieldNames(schema.body)).toEqual(['id', 'name']);
            expect(h.reached.filter((r) => r.env !== ENV_SEC_OK)).toEqual([]);
        }, 60_000);

        it(`no security service registered (${mount}): every door serves, as a deployment without a permission posture does`, async () => {
            const exported = await drivePosture(h, POSTURE_DOORS.export, mount, ENV_SEC_NONE);
            expect(exported.status, JSON.stringify(exported.body)).toBe(200);
            expect(h.reached).toEqual([{ env: ENV_SEC_NONE, op: 'findData' }]);
            expect(String(exported.written.join(''))).toContain(`row_${ENV_SEC_NONE}`);

            const template = await drivePosture(h, POSTURE_DOORS.templateGate, mount, ENV_SEC_NONE);
            expect(template.status, JSON.stringify(template.body)).toBe(200);
            expect(template.headers['X-Export-Template-Projection']).toBe('none');

            const schema = await drivePosture(h, POSTURE_DOORS.mask, mount, ENV_SEC_NONE);
            expect(schema.status, JSON.stringify(schema.body)).toBe(200);
            expect(servedFieldNames(schema.body)).toEqual(['id', 'name', 'secret']);
            expect(h.reached.filter((r) => r.env === 'host')).toEqual([]);
        }, 60_000);

        for (const { env, how } of UNRESOLVABLE) {
            it(`the export (${mount}) refuses when the environment's security service ${how}, and reads no row`, async () => {
                expectUnresolvableRefusal(h, await drivePosture(h, POSTURE_DOORS.export, mount, env));
                expect(h.reached).toEqual([]);
            }, 60_000);

            it(`the import template's gate (${mount}) refuses when the environment's security service ${how}`, async () => {
                const out = await drivePosture(h, POSTURE_DOORS.templateGate, mount, env);
                expectUnresolvableRefusal(h, out);
                expect(out.headers['X-Export-Template-Projection']).toBeUndefined();
                expect(h.reached).toEqual([]);
            }, 60_000);

            it(`the object-schema mask (${mount}) refuses when the environment's security service ${how}`, async () => {
                expectUnresolvableRefusal(h, await drivePosture(h, POSTURE_DOORS.mask, mount, env));
                expect(h.reached).toEqual([]);
            }, 60_000);
        }

        it(`the import template's column projection (${mount}) refuses when its security step cannot be resolved after the gate answered`, async () => {
            const out = await drivePosture(h, POSTURE_DOORS.template, mount, ENV_SEC_ACQ, 2);
            expectUnresolvableRefusal(h, out);
            expect(out.headers['X-Export-Template-Projection']).toBeUndefined();
            // The gate WAS answered (create is allowed on `memo`); the
            // projection that follows it was never asked.
            expect(h.reached).toEqual([{ env: ENV_SEC_ACQ, op: 'security.explain' }]);
        }, 60_000);

        it(`every acquisition rejecting (${mount}) still fails the request before any door serves`, async () => {
            for (const door of Object.values(POSTURE_DOORS)) {
                const out = await drivePosture(h, door, mount, ENV_SEC_DOWN);
                // Refused by whichever step fails first (the protocol, or the
                // caller's identity), never answered as a served door.
                expect(out.status, `${door.path} ${JSON.stringify(out.body)}`).toBeGreaterThanOrEqual(400);
                expect(out.written).toEqual([]);
                expect(servedFieldNames(out.body)).toEqual([]);
                expect(h.reached).toEqual([]);
            }
        }, 60_000);
    }

    it('the resolver still answers `undefined` for an environment whose kernel registers no security service', async () => {
        for (const req of [hostnameRequest(ENV_SEC_NONE), scopedRequest(ENV_SEC_NONE)]) {
            await expect(h.server.resolveSecurityService(req.params.environmentId, req)).resolves.toBeUndefined();
        }
    }, 60_000);
});

describe('a single kernel with no security service keeps serving every door, as before', () => {
    let h: Hosted;
    beforeAll(async () => {
        const reached: Reached[] = [];
        const http = recordingHttp();
        captured.servers.length = 0;
        const kernel = await bootKernel('test.single.no-security', {
            'http.server': http,
            protocol: postureProtocol('host', reached),
            auth: authServiceFor('u_host'),
            objectql: emptyQl(),
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

    it('the resolver answers `undefined`, and the export serves its rows', async () => {
        const req = hostnameRequest('host');
        await expect(h.server.resolveSecurityService(undefined, req)).resolves.toBeUndefined();
        const out = await drivePosture({ ...h, securityStep: { rejectFrom: 1, count: 0, rejecting: false } },
            POSTURE_DOORS.export, 'hostname', 'host');
        expect(out.status, JSON.stringify(out.body)).toBe(200);
        expect(h.reached).toEqual([{ env: 'host', op: 'findData' }]);
    }, 60_000);
});
