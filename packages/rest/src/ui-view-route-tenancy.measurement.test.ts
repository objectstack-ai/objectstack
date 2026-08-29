// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13214] Does `GET /api/v1/ui/view/:object/:type` cross ENVIRONMENTS?
 *
 * ## What this file is, and what it is not
 *
 * ⛔ A MEASUREMENT file. It repairs nothing, gates nothing, proposes nothing.
 * `rest-server.ts` is byte-identical on this branch. Access-control behaviour
 * is a human floor in this repo: if a reading below is a problem, the repair is
 * a card of its own with a human decision on it.
 *
 * ## Why it exists separately from `ui-view-route-identity.measurement.test.ts`
 *
 * That file (PR #13244) settled the SINGLE-TENANT half and settled it hard:
 * this route resolves no identity at the REST seam, and `getUiView` applies no
 * authorization downstream because the seam hands it exactly `{ object, type }`.
 * ⛔ None of that is re-measured here.
 *
 * What it explicitly did NOT assert is the axis a severity call turns on. Its
 * harness had no `envRegistry` and no `kernelManager`, so the environment
 * resolution chain was READ FROM SOURCE and never driven:
 *
 *   > On the unscoped mount `registerUiEndpoints` passes `environmentId:
 *   > undefined`, so `resolveProtocol` falls to
 *   > `resolveRequestEnvironmentId(undefined, req)`, which resolves an
 *   > environment from the injected resolver, then the request HOSTNAME, then
 *   > the `X-Environment-Id` header.
 *
 * If that chain holds under drive, an ANONYMOUS caller can name a specific
 * environment and receive THAT environment's UI view — a different finding at a
 * different severity from single-tenant metadata disclosure. This file drives
 * it for the first time. The previous reading is treated as a hypothesis, not
 * as a fact.
 *
 * ## ⭐ The instrument is proved bidirectional BEFORE any reading is trusted
 *
 * A measurement that cannot come out the other way has measured nothing, and
 * that cuts BOTH ways here: a harness that always answers "environment B" is no
 * evidence of a crossing, and one that can only ever answer "environment A" is
 * no evidence of its absence. So §0 does four things before §1 reads anything:
 *
 *   - C1: the two environments' producers, called directly, answer observably
 *     differently (distinct object label, disjoint field sets).
 *   - C2: with no header and an unbound hostname the route answers with
 *     environment A's view — so "would otherwise resolve to A" is a measured
 *     baseline, not an assumption.
 *   - C3: the SCOPED mount (`/environments/:environmentId/ui/view/...`), where
 *     naming an environment is the declared, URL-visible way to do it, answers
 *     with environment B's view. So this route CAN deliver B's body through
 *     this instrument, and a negative in §1/§2 would be a real negative.
 *   - C4: the kernel-acquisition recorder really records which environment was
 *     acquired, so `acquired` is an observable and not a constant.
 *
 * ## ⚠️ Constructor arity — the previous run's self-caught bug, mechanised
 *
 * PR #13244 wrote a 27-argument call to the 20-parameter `RestServer`
 * constructor. It RAN, while silently shifting three providers onto the wrong
 * parameters: a harness that executes can still be wrong at the reading level,
 * and a tenancy harness is exactly where that bites, because `kernelManager`
 * and `envRegistry` are positions 4 and 5. Rather than counting again, the boot
 * below builds its arguments as a `ConstructorParameters<typeof RestServer>`
 * tuple, so BOTH the arity and every position's type are checked by
 * `tsconfig.test.json` — which does compile this file.
 *
 * ## ⚠️ `@objectstack/metadata-protocol` resolves to `dist/` here
 *
 * This package's vitest config aliases `plugin-hono-server` and
 * `service-datasource` to source; `metadata-protocol` is deliberately NOT
 * aliased (it is registered in `KNOWN_UNALIASED_TEST_IMPORTS` for
 * `@objectstack/rest`), so every section that drives the real producer reads
 * the BUILT artifact. Stated rather than assumed: the workspace closure was
 * built before these readings were taken, and §3 asserts a post-#5948 shape
 * (`object` on the container) that a stale `dist/` would fail loudly on rather
 * than reporting an old producer's behaviour as current.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import type { RestEnvRegistry, RestKernelManager, RestRequestEnvResolver } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

const BASE = '/api/v1';
const UI_ROUTE = `GET ${BASE}/ui/view/:object/:type`;
const UI_ROUTE_SCOPED = `GET ${BASE}/environments/:environmentId/ui/view/:object/:type`;
const DATA_ROUTE = `GET ${BASE}/data/:object`;

const ENV_A = 'env_alpha';
const ENV_B = 'env_beta';
const HOST_A = 'alpha.example.test';
const HOST_B = 'beta.example.test';
/** Bound to nothing in the registry — the "would otherwise resolve to A" case. */
const HOST_NEUTRAL = 'neutral.example.test';

// ---------------------------------------------------------------------------
// Fixtures — two environments made OBSERVABLY different on purpose
// ---------------------------------------------------------------------------

/**
 * Environment A. Its `alpha_only_field` and its object label are the tell.
 */
const SCHEMA_A = {
    name: 'account',
    label: 'Alpha Environment Accounts',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Alpha Account Name', required: true },
        alpha_only_field: { name: 'alpha_only_field', type: 'text', label: 'Alpha Only' },
        created_at: { name: 'created_at', type: 'datetime' },
    },
};

/**
 * Environment B — the environment an anonymous caller is trying to reach.
 *
 * Two `hidden` fields, deliberately of DIFFERENT kinds, because §3 measures the
 * blast radius on the crossed path rather than inheriting #13244's
 * single-tenant answer:
 *   - `beta_secret` is hidden and NOT one of the producer's priority names;
 *   - `status` is hidden and IS one of them (`name`, `title`, `label`,
 *     `subject`, `email`, `status`, `type`, `category`, `created_at`).
 * Whether those two are treated the same is measured, not assumed.
 */
const SCHEMA_B = {
    name: 'account',
    label: 'Beta Environment Accounts',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Beta Account Name', required: true },
        beta_only_field: { name: 'beta_only_field', type: 'text', label: 'Beta Only' },
        status: { name: 'status', type: 'text', label: 'Beta Status', hidden: true },
        beta_secret: { name: 'beta_secret', type: 'text', label: 'Beta Secret', hidden: true },
        created_at: { name: 'created_at', type: 'datetime' },
    },
};

/**
 * The control-plane protocol captured at boot — a THIRD distinct answer, so
 * "fell through to the control plane" is distinguishable from "resolved to A"
 * instead of the two collapsing into one indistinguishable reading.
 */
const SCHEMA_CONTROL = {
    name: 'account',
    label: 'Control Plane Accounts',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Control Plane Name' },
        control_only_field: { name: 'control_only_field', type: 'text', label: 'Control Only' },
    },
};

function protocolFor(schema: unknown): any {
    // ⚠️ `null` means "no such object"; `undefined` would be a different bug.
    const engine = { registry: { getObject: (name: string) => (name === 'account' ? schema : null) } };
    return new ObjectStackProtocolImplementation(engine as any) as any;
}

function schemaForEnv(environmentId: string): unknown {
    if (environmentId === ENV_A) return SCHEMA_A;
    if (environmentId === ENV_B) return SCHEMA_B;
    return null;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Handler = (req: any, res: any) => any;

function recordingServer() {
    const table = new Map<string, Handler>();
    const on = (m: string) => (p: string, h: Handler) => { table.set(`${m} ${p}`, h); };
    return {
        table,
        get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
        use: () => {}, listen: async () => {}, close: async () => {},
    } as any;
}

function anyService() {
    return new Proxy({}, {
        get: (_t, k: string) => (k === 'then' || k === 'constructor')
            ? undefined
            : (async () => ({ ok: true, rows: [], data: [], total: 0 })),
    });
}

/** The real multi-tenant wiring the previous harness did not have. */
function tenantWiring() {
    const hostnameLookups: string[] = [];
    const idLookups: string[] = [];
    const acquired: string[] = [];

    const envRegistry: RestEnvRegistry = {
        async resolveByHostname(hostname: string) {
            hostnameLookups.push(hostname);
            if (hostname === HOST_A) return { environmentId: ENV_A };
            if (hostname === HOST_B) return { environmentId: ENV_B };
            return null;
        },
        async resolveById(environmentId: string) {
            idLookups.push(environmentId);
            // Truthy = "this environment exists and is bound". The REST server
            // only reads the truthiness (see `RestEnvRegistry`).
            return environmentId === ENV_A || environmentId === ENV_B ? { driver: environmentId } : null;
        },
    };

    const kernelManager: RestKernelManager = {
        async getOrCreate(environmentId: string) {
            acquired.push(environmentId);
            const protocol = protocolFor(schemaForEnv(environmentId));
            return { getServiceAsync: async <T,>() => protocol as T };
        },
    };

    return { envRegistry, kernelManager, hostnameLookups, idLookups, acquired };
}

interface Wiring {
    envRegistry?: RestEnvRegistry;
    kernelManager?: RestKernelManager;
    defaultEnvironmentId?: string;
    requestEnvResolver?: RestRequestEnvResolver;
}

function makeServer(wiring: Wiring) {
    const server = recordingServer();
    const provider = async () => anyService();
    // ⭐ The arity/position pin. A tuple typed as the constructor's own
    // parameter list: a surplus argument is a compile error rather than a
    // silently shifted provider, and every position is type-checked against the
    // parameter it lands on. `kernelManager` and `envRegistry` are positions 4
    // and 5 — the two this whole file turns on.
    const args: ConstructorParameters<typeof RestServer> = [
        /*  1 server                       */ server,
        /*  2 protocol (control plane)     */ protocolFor(SCHEMA_CONTROL),
        /*  3 config                       */ { api: { enableProjectScoping: true, projectResolution: 'auto' } },
        /*  4 kernelManager                */ wiring.kernelManager,
        /*  5 envRegistry                  */ wiring.envRegistry,
        /*  6 defaultEnvironmentIdProvider */ () => wiring.defaultEnvironmentId,
        /*  7 authServiceProvider          */ provider,
        /*  8 objectQLProvider             */ provider,
        /*  9 emailServiceProvider         */ provider,
        /* 10 sharingServiceProvider       */ provider,
        /* 11 reportsServiceProvider       */ provider,
        /* 12 approvalsServiceProvider     */ provider,
        /* 13 sharingRulesServiceProvider  */ provider,
        /* 14 i18nServiceProvider          */ provider,
        /* 15 analyticsServiceProvider     */ provider,
        /* 16 settingsServiceProvider      */ provider,
        /* 17 serviceExistsProvider        */ () => true,
        /* 18 securityServiceProvider      */ provider,
        /* 19 requestEnvResolver           */ wiring.requestEnvResolver,
        /* 20 metadataServiceProvider      */ provider,
    ];
    const rs: any = new RestServer(...args);
    return { rs, table: server.table as Map<string, Handler> };
}

/**
 * Replace `resolveExecCtx` with the leg's value and COUNT the calls. The count
 * is an independent observable: "answers with B's view" is compatible with a
 * route that resolved identity and found it sufficient; "answers with B's view
 * AND never asked" is not.
 */
function instrument(ctxValue: any) {
    const proto: any = (RestServer as any).prototype;
    const original = proto.resolveExecCtx;
    const calls = { n: 0 };
    proto.resolveExecCtx = async function () {
        calls.n++;
        return ctxValue === undefined ? undefined : { ...ctxValue };
    };
    return { calls, restore: () => { proto.resolveExecCtx = original; } };
}

interface Observed {
    status: number;
    code: unknown;
    body: any;
    threw?: string;
    execCtxCalls: number;
    acquired: string[];
    hostnameLookups: string[];
    idLookups: string[];
}

const ENTITLED = {
    userId: 'u_13214',
    isSystem: false,
    tenantId: 'org_13214',
    systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
};

interface DriveOptions {
    route?: string;
    params?: Record<string, string>;
    host?: string;
    environmentIdHeader?: string;
    /** `undefined` = an ANONYMOUS caller: no execution context at all. */
    ctx?: any;
    /** Omit to get the standard two-environment wiring. */
    wiring?: Wiring;
    /** Extra headers, so "carries nothing else" is expressible. */
    headers?: Record<string, string>;
}

async function drive(opts: DriveOptions): Promise<Observed> {
    const shared = tenantWiring();
    const wiring: Wiring = opts.wiring ?? {
        envRegistry: shared.envRegistry,
        kernelManager: shared.kernelManager,
        defaultEnvironmentId: ENV_A,
    };
    // When the caller supplied its own wiring we still need the recorders that
    // belong to it; the shared ones only mean anything for the default wiring.
    const usingShared = opts.wiring === undefined;

    const probe = instrument(opts.ctx);
    const { rs, table } = makeServer(wiring);
    rs.registerRoutes();

    const route = opts.route ?? UI_ROUTE;
    const handler = table.get(route);
    if (!handler) { probe.restore(); throw new Error(`route not mounted: ${route}`); }
    const [method, pattern] = route.split(' ');

    const headers: Record<string, string> = {
        host: opts.host ?? HOST_NEUTRAL,
        ...(opts.environmentIdHeader ? { 'x-environment-id': opts.environmentIdHeader } : {}),
        ...(opts.headers ?? {}),
    };

    let status = 0; let body: any; let sent = false;
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: any) { body = b; sent = true; },
        send() { sent = true; }, header() { return res; }, setHeader() { return res; },
        end() { sent = true; }, write() { return true; }, type() { return res; },
    };
    let threw: string | undefined;
    try {
        await handler({
            params: opts.params ?? { object: 'account', type: 'list' },
            query: {}, body: {}, method, path: pattern, headers, url: pattern,
        } as any, res);
    } catch (e: any) { threw = String(e?.message ?? e).slice(0, 200); }

    const observed: Observed = {
        status: status || (sent ? 200 : 0),
        code: body?.code ?? body?.error?.code ?? body?.error,
        body,
        threw,
        execCtxCalls: probe.calls.n,
        acquired: usingShared ? [...shared.acquired] : [],
        hostnameLookups: usingShared ? [...shared.hostnameLookups] : [],
        idLookups: usingShared ? [...shared.idLookups] : [],
    };
    probe.restore();
    return observed;
}

/** The two tells, pulled out so every assertion below reads the same way. */
const labelOf = (b: any): unknown => b?.list?.label;
const columnsOf = (b: any): string[] => ((b?.list?.columns ?? []) as any[]).map((c) => c.field);
const formFieldsOf = (b: any): string[] => {
    const sections = (b?.form?.sections ?? []) as any[];
    return sections.flatMap((s) => (s.fields ?? []).map((f: any) => f.field));
};

// ---------------------------------------------------------------------------
// 0. ⭐ Instrument controls — run FIRST, because nothing below is worth
//    anything until both answers are demonstrably observable
// ---------------------------------------------------------------------------

describe('[#13214] §0 the instrument can tell environment A from environment B', () => {
    it("C1 — the two environments' producers answer observably differently when called directly", async () => {
        const a = await protocolFor(SCHEMA_A).getUiView({ object: 'account', type: 'list' });
        const b = await protocolFor(SCHEMA_B).getUiView({ object: 'account', type: 'list' });

        expect(labelOf(a)).toBe('Alpha Environment Accounts');
        expect(labelOf(b)).toBe('Beta Environment Accounts');
        expect(columnsOf(a)).toContain('alpha_only_field');
        expect(columnsOf(b)).toContain('beta_only_field');
        // Disjoint tells in BOTH directions, so neither body can be mistaken
        // for the other by a partial match.
        expect(columnsOf(a)).not.toContain('beta_only_field');
        expect(columnsOf(b)).not.toContain('alpha_only_field');
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    }, 120_000);

    it("C2 — with NO header and an UNBOUND hostname the route answers with environment A's view", async () => {
        // This is the "would otherwise resolve to A" baseline every §1/§2
        // reading is measured against. It is driven, not assumed.
        const observed = await drive({ host: HOST_NEUTRAL, ctx: undefined });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(columnsOf(observed.body)).toContain('alpha_only_field');
        expect(observed.acquired).toEqual([ENV_A]);
        // ...and NOT the control-plane protocol, which is a third distinct
        // answer precisely so this cannot silently be that instead.
        expect(labelOf(observed.body)).not.toBe('Control Plane Accounts');
    }, 120_000);

    it("C3 — the SCOPED mount, where naming an environment is declared and URL-visible, DOES deliver environment B's view", async () => {
        // ⭐ The control that makes a negative in §1/§2 meaningful. If the route
        // could never deliver B's body on this instrument, "no crossing" would
        // be a property of the harness rather than a reading about the code.
        const observed = await drive({
            route: UI_ROUTE_SCOPED,
            params: { environmentId: ENV_B, object: 'account', type: 'list' },
            host: HOST_NEUTRAL,
            ctx: undefined,
        });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
        expect(columnsOf(observed.body)).toContain('beta_only_field');
        expect(observed.acquired).toEqual([ENV_B]);
    }, 120_000);

    it('C4 — the kernel-acquisition recorder is an observable, not a constant', async () => {
        const a = await drive({ host: HOST_A, ctx: undefined });
        const b = await drive({
            route: UI_ROUTE_SCOPED,
            params: { environmentId: ENV_B, object: 'account', type: 'list' },
            ctx: undefined,
        });
        expect(a.acquired).toEqual([ENV_A]);
        expect(b.acquired).toEqual([ENV_B]);
        expect(a.acquired).not.toEqual(b.acquired);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 1. CHANNEL ONE — the `X-Environment-Id` header, presented by an ANONYMOUS
//    caller on the UNSCOPED mount
// ---------------------------------------------------------------------------

describe('[#13214] §1 channel: the `X-Environment-Id` header', () => {
    it("⭐ an ANONYMOUS request naming environment B on an unscoped URL receives environment B's view", async () => {
        const observed = await drive({
            host: HOST_NEUTRAL,          // resolves to nothing → would fall to A
            environmentIdHeader: ENV_B,  // the only thing the caller supplies
            ctx: undefined,              // ⭐ no execution context whatsoever
        });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
        expect(columnsOf(observed.body)).toContain('beta_only_field');
        expect(columnsOf(observed.body)).not.toContain('alpha_only_field');

        // Three independent observations, not one:
        //   - the answer is B's, not the A baseline C2 measured;
        expect(labelOf(observed.body)).not.toBe('Alpha Environment Accounts');
        //   - B's kernel was actually ACQUIRED by an anonymous request;
        expect(observed.acquired).toEqual([ENV_B]);
        //   - and identity was never asked for, on any site the request reached.
        expect(observed.execCtxCalls).toBe(0);
    }, 120_000);

    it('the answer does not depend on the caller — an ENTITLED caller naming B gets byte-identical bytes', async () => {
        const anon = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const entitled = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: ENTITLED });
        expect(JSON.stringify(anon.body)).toBe(JSON.stringify(entitled.body));
        expect(entitled.execCtxCalls).toBe(0);
    }, 120_000);

    it('⭐ NEGATIVE CONTROL — a header naming an environment the registry does NOT know does not cross', async () => {
        // So the crossing is not "any string in the header wins". The id is
        // validated through `envRegistry.resolveById`, and an unknown one falls
        // through to the default. This is what makes §4's precondition precise.
        const observed = await drive({
            host: HOST_NEUTRAL,
            environmentIdHeader: 'env_ghost_does_not_exist',
            ctx: undefined,
        });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
        // The registry WAS consulted — a green above is a decision, not a
        // header the server never looked at.
        expect(observed.idLookups).toContain('env_ghost_does_not_exist');
    }, 120_000);

    it('the caller supplies nothing but the header — no cookie, no authorization, no session', async () => {
        const observed = await drive({
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: undefined,
            headers: {}, // nothing added; the request carries `host` + the one header
        });
        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 2. CHANNEL TWO — the request HOSTNAME. A separate answer from §1, and it is
//    measured separately because it may differ.
// ---------------------------------------------------------------------------

describe('[#13214] §2 channel: the request hostname', () => {
    it("⭐ an ANONYMOUS request whose hostname is bound to environment B receives environment B's view", async () => {
        const observed = await drive({ host: HOST_B, ctx: undefined });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
        expect(columnsOf(observed.body)).toContain('beta_only_field');
        expect(observed.acquired).toEqual([ENV_B]);
        expect(observed.execCtxCalls).toBe(0);
        expect(observed.hostnameLookups).toContain(HOST_B);
    }, 120_000);

    it('⭐ CONTROL — the same channel answers with A when the hostname is bound to A, so it is bidirectional', async () => {
        const observed = await drive({ host: HOST_A, ctx: undefined });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
    }, 120_000);

    it('⭐ NEGATIVE CONTROL — an unbound hostname does not cross; it falls to the default environment', async () => {
        const observed = await drive({ host: 'unbound.example.test', ctx: undefined });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
        expect(observed.hostnameLookups).toContain('unbound.example.test');
    }, 120_000);

    it('PRECEDENCE — hostname is consulted BEFORE the header, so a bound host wins over a header naming the other environment', async () => {
        // Matters for §4: on a hostname-routed deployment the header is not an
        // additional lever, and on a non-hostname deployment it is the lever.
        const observed = await drive({ host: HOST_A, environmentIdHeader: ENV_B, ctx: undefined });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
        // The header was never even looked up, which is the mechanism.
        expect(observed.idLookups).not.toContain(ENV_B);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 3. BLAST RADIUS on the CROSS-ENVIRONMENT path — measured here, ⛔ not
//    inherited from #13244's single-tenant result
// ---------------------------------------------------------------------------

describe('[#13214] §3 what the crossed response actually contains', () => {
    it('the list body is exactly the view envelope — object, view type, label, columns, sort, searchable fields', async () => {
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const body = observed.body;

        // ⭐ Pinned to the CROSSED body first, so this is an inventory of what
        // environment B disclosed and not of whatever the route happened to
        // answer — an envelope assertion alone is true of either environment.
        expect(labelOf(body)).toBe('Beta Environment Accounts');
        expect(Object.keys(body).sort()).toEqual(['list', 'object']);
        expect(body.object).toBe('account');
        // Post-#5948 shape: `object` on the CONTAINER. A `dist/` from before
        // that relocation would put it on `list` and fail here loudly rather
        // than reporting an old producer's behaviour as current.
        expect(body.list.object).toBeUndefined();
        expect(Object.keys(body.list).sort()).toEqual(['columns', 'label', 'searchableFields', 'sort', 'type']);
        for (const column of body.list.columns) {
            expect(Object.keys(column).sort()).toEqual(['field', 'label', 'sortable']);
        }
    }, 120_000);

    it('⛔ NO record data crosses — the payload carries metadata only', async () => {
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const serialized = JSON.stringify(observed.body);
        // Same pinning as above: this is a statement about B's payload.
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
        for (const key of ['rows', 'records', 'data', 'total', 'values', 'items']) {
            expect(observed.body[key], `body carried \`${key}\``).toBeUndefined();
        }
        // And nothing about the environment's plumbing: no driver, no
        // connection string, no environment id echoed back.
        for (const term of ['driver', 'connection', 'datasource', 'password', 'secret_key', ENV_B]) {
            expect(serialized.includes(term), `payload mentioned \`${term}\``).toBe(false);
        }
    }, 120_000);

    it('the FORM branch crosses too, and carries the per-field required/readonly/type declarations', async () => {
        const observed = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined,
            params: { object: 'account', type: 'form' },
        });
        expect(observed.status).toBe(200);
        expect(formFieldsOf(observed.body)).toContain('beta_only_field');
        expect(formFieldsOf(observed.body)).not.toContain('alpha_only_field');
        const field = (observed.body.form.sections[0].fields as any[]).find((f) => f.field === 'name');
        expect(field.required).toBe(true);
        expect(field.label).toBe('Beta Account Name');
        expect(field.type).toBe('text');
    }, 120_000);

    it('⚠️ `hidden` is NOT a uniform floor on the crossed path — measured per field, not assumed', async () => {
        // ⛔ #13244 measured this single-tenant with ONE hidden field, which was
        // not a priority name, and reported "hidden is dropped by declaration".
        // Driven here with both kinds, the answer is not uniform:
        //   - `beta_secret` (hidden, non-priority) IS dropped from the list;
        //   - `status`      (hidden, priority name) is NOT.
        // The producer's list branch applies `!fields[k].hidden` only to the
        // FILL pass, never to the priority pass. Recorded as a measurement; the
        // repair is not this card.
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const columns = columnsOf(observed.body);

        expect(columns).not.toContain('beta_secret');
        expect(columns).toContain('status');
        // The label of the hidden priority field crosses with it.
        const statusColumn = (observed.body.list.columns as any[]).find((c) => c.field === 'status');
        expect(statusColumn.label).toBe('Beta Status');

        // The form branch, by contrast, filters ALL hidden fields uniformly —
        // so the two branches of one producer disagree, which is the finding.
        const form = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined,
            params: { object: 'account', type: 'form' },
        });
        expect(formFieldsOf(form.body)).not.toContain('status');
        expect(formFieldsOf(form.body)).not.toContain('beta_secret');
    }, 120_000);

    it('⚠️ the crossed route is also an OBJECT-EXISTENCE ORACLE for the named environment', async () => {
        // A present object answers 200 and an absent one does not, so the same
        // anonymous request distinguishes "environment B has an object called
        // X" from "it does not" — a second reading, distinct from the payload.
        const present = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const absent = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined,
            params: { object: 'no_such_object_here', type: 'list' },
        });
        expect(present.status).toBe(200);
        // Pinned to B, so the oracle is a reading about the NAMED environment's
        // object namespace rather than about the default one.
        expect(labelOf(present.body)).toBe('Beta Environment Accounts');
        expect(absent.acquired).toEqual([ENV_B]);
        expect(absent.status).not.toBe(200);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. PRECONDITIONS — ⚠️ exactly what a caller must know, and which deployment
//    shapes are reachable at all. The severity grade turns on this section.
// ---------------------------------------------------------------------------

describe('[#13214] §4 preconditions', () => {
    it('with NEITHER an envRegistry NOR a kernelManager there is no crossing — which is why #13244 could not see one', async () => {
        // ⭐ This is both a precondition reading and a control on the earlier
        // sections: it reproduces the previous harness's wiring and shows the
        // header is inert there. So §1's crossing is a function of the tenancy
        // wiring, not of anything else this file changed.
        const observed = await drive({
            host: HOST_B,
            environmentIdHeader: ENV_B,
            ctx: undefined,
            wiring: { defaultEnvironmentId: undefined },
        });
        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Control Plane Accounts');
    }, 120_000);

    it('an envRegistry WITHOUT a kernelManager does not cross either — the chain needs both', async () => {
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_B,
            environmentIdHeader: ENV_B,
            ctx: undefined,
            wiring: { envRegistry: shared.envRegistry, defaultEnvironmentId: ENV_A },
        });
        // Env resolution is skipped entirely (the guard is `envRegistry &&
        // kernelManager`), so it falls to the default id — and with no kernel
        // manager, to the control-plane protocol.
        expect(labelOf(observed.body)).toBe('Control Plane Accounts');
    }, 120_000);

    it('⭐ a host that wires a `requestEnvResolver` is NOT reachable through either channel — its normal return is FINAL', async () => {
        // The mitigating fact, measured rather than read: ADR-0076 D11 step ④.
        // When the host injects a resolver, the legacy hostname/header chain is
        // never consulted, so a deployment wiring `kernel-resolver` pins the
        // request to whatever that strategy says.
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_B,                 // bound to B
            environmentIdHeader: ENV_B,   // and naming B
            ctx: undefined,
            wiring: {
                envRegistry: shared.envRegistry,
                kernelManager: shared.kernelManager,
                defaultEnvironmentId: ENV_A,
                requestEnvResolver: { async resolveRequestEnvironmentId() { return ENV_A; } },
            },
        });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
    }, 120_000);

    it('⭐ CONTROL — the same injected resolver CAN send the request to B, so the reading above is the resolver deciding, not a dead channel', async () => {
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_NEUTRAL,
            ctx: undefined,
            wiring: {
                envRegistry: shared.envRegistry,
                kernelManager: shared.kernelManager,
                defaultEnvironmentId: ENV_A,
                requestEnvResolver: { async resolveRequestEnvironmentId() { return ENV_B; } },
            },
        });
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
    }, 120_000);

    it('a THROWING injected resolver degrades to the legacy chain, and the header crosses again', async () => {
        // Named because it is the difference between "wiring a resolver closes
        // this" and "wiring a resolver closes this unless it throws".
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: undefined,
            wiring: {
                envRegistry: shared.envRegistry,
                kernelManager: shared.kernelManager,
                defaultEnvironmentId: ENV_A,
                requestEnvResolver: { async resolveRequestEnvironmentId() { throw new Error('resolver down'); } },
            },
        });
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
    }, 120_000);

    it('⚠️ the route is also an ENVIRONMENT-ID ORACLE — a valid id and an invalid one get observably different answers', async () => {
        // Bears directly on "what must an attacker already know". The id is
        // validated, but the FAILURE is not signalled: an unknown id silently
        // falls through to the default environment and answers 200 with THAT
        // environment's view. So a caller with no credential can tell a real
        // environment id from a made-up one by comparing two 200s — which is
        // the difference between "must possess an id" and "can discover one".
        const valid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const invalid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: 'env_not_real', ctx: undefined });

        expect(valid.status).toBe(200);
        expect(invalid.status).toBe(200);
        // Same status, different bytes — the oracle.
        expect(JSON.stringify(valid.body)).not.toBe(JSON.stringify(invalid.body));
        expect(labelOf(valid.body)).toBe('Beta Environment Accounts');
        expect(labelOf(invalid.body)).toBe('Alpha Environment Accounts');
        // ...and the same holds for the OTHER known environment, so the signal
        // is "this id resolves" rather than "this id is B".
        const otherValid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_A, ctx: undefined });
        expect(labelOf(otherValid.body)).toBe('Alpha Environment Accounts');
        expect(otherValid.idLookups).toContain(ENV_A);
    }, 120_000);

    it('the unscoped mount passes `environmentId: undefined` — read off the registrar body, not off a grep of the file', () => {
        // The source half of the mechanism, scoped to the registrar so a
        // neighbour's code cannot satisfy it.
        const start = SOURCE.indexOf('private registerUiEndpoints(');
        const end = SOURCE.indexOf('private registerCrudEndpoints(');
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const body = SOURCE.slice(start, end);

        expect(body).toContain("const isScoped = basePath.includes('/environments/:environmentId')");
        expect(body).toContain('const environmentId = isScoped ? req.params?.environmentId : undefined;');
        expect(body).toContain('this.resolveProtocol(environmentId, req)');
        // ⛔ Reverse-checked zeros: the same two terms are counted over the
        // WHOLE file, so a zero here is "absent from this registrar", never
        // "misspelled".
        expect(body.includes('this.enforceAuth(')).toBe(false);
        expect(body.includes('this.resolveExecCtx(')).toBe(false);
        expect(SOURCE.split('this.enforceAuth(').length - 1).toBeGreaterThan(40);
        expect(SOURCE.split('this.resolveExecCtx(').length - 1).toBeGreaterThan(40);
    });
});

// ---------------------------------------------------------------------------
// 5. CONTRAST — the same tenancy wiring, a guarded sibling route
// ---------------------------------------------------------------------------

describe('[#13214] §5 a guarded sibling under the SAME tenancy wiring still refuses', () => {
    it("`GET /data/:object` naming environment B anonymously answers 401, not B's data", async () => {
        // ⭐ The instrument-level control for the whole file: this harness DOES
        // express a refusal, so §1/§2's 200s are readings about this route and
        // not a driver that cannot produce a 401.
        const observed = await drive({
            route: DATA_ROUTE,
            params: { object: 'account' },
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: undefined,
        });
        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(observed.code).toBe(ANONYMOUS_DENY_CODE);
        expect(observed.execCtxCalls).toBeGreaterThan(0);
    }, 120_000);

    it('...and the same route SERVES an entitled caller, so the 401 above is a decision and not a stuck needle', async () => {
        const observed = await drive({
            route: DATA_ROUTE,
            params: { object: 'account' },
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: ENTITLED,
        });
        expect(observed.status).not.toBe(ANONYMOUS_DENY_STATUS);
        expect(observed.execCtxCalls).toBeGreaterThan(0);
    }, 120_000);

    it('⚠️ but the foreign kernel is ACQUIRED before the refusal — the deny is at the seam, after environment resolution', async () => {
        // A separate observation from the 401: the anonymous request still
        // caused environment B's kernel to be materialised. Recorded because it
        // is about the ORDER of the two steps, which no status code shows.
        const observed = await drive({
            route: DATA_ROUTE,
            params: { object: 'account' },
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: undefined,
        });
        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(observed.acquired).toEqual([ENV_B]);
    }, 120_000);
});
