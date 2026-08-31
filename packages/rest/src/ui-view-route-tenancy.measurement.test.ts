// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13214] Does `GET /api/v1/ui/view/:object/:type` cross ENVIRONMENTS?
 *
 * ## ⭐ What this file is NOW: the regression pin for the repair it measured
 *
 * It was written as a MEASUREMENT file and it measured a live cross-environment
 * disclosure: every assertion below pinned the LEAK as present. The maintainer
 * ruled the repair on 2026-08-30 (option C — the seam must require that the
 * resolved environment belong to the caller), and this file has been INVERTED
 * onto the repaired behaviour rather than deleted or softened. ⛔ Nothing here
 * was weakened into vagueness: each reading that said "B's view crosses to a
 * caller with no claim on B" now says "it is refused", against the same
 * instrument, the same fixtures and the same controls.
 *
 * A suite that measured a leak is the best available regression pin once
 * flipped: it fails if the leak returns by ANY of the routes it drove.
 *
 * ⚠️ The 2026-08-29 readings recorded here were TRUE WHEN TAKEN. Where a case
 * changed colour, the history stays in the comment — a reader who finds only
 * the post-repair assertion cannot tell whether the leak ever existed.
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

/**
 * ⭐ An execution context ANCHORED in one environment — the shape the repaired
 * seam reads, and the reason this helper exists rather than a bare `ENTITLED`.
 *
 * `instrument()` below replaces `resolveExecCtx` wholesale, so every context in
 * this file is synthetic and must MODEL what the real producer emits.
 * `computeExecCtx` records which environment's auth service actually validated
 * the caller on `__authEnvironmentId`, and `enforceEnvironmentOwnership`
 * compares that against the environment the request resolved to. A synthetic
 * context that omits the key is a caller whose credential is anchored NOWHERE,
 * which the seam refuses — fail-closed, and deliberately so.
 *
 * ⚠️ That the real producer sets this key truthfully — including the
 * cross-environment fallback branch where it does NOT equal the resolved
 * environment — is not assertable through a stub, so it is pinned separately
 * against the unstubbed method in `ui-view-environment-ownership.test.ts`.
 * Without that file every assertion here would be reading a fact this file
 * supplies to itself.
 */
const entitledIn = (environmentId: string) => ({ ...ENTITLED, __authEnvironmentId: environmentId });

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
        //
        // ⚠️ FLIPPED INPUT, not a flipped claim: the baseline used to be taken
        // with `ctx: undefined`, because before the repair an anonymous caller
        // was served. The environment resolution being measured is unchanged;
        // reaching it now requires a caller entitled to the environment it
        // resolves to, so the baseline is taken with one.
        const observed = await drive({ host: HOST_NEUTRAL, ctx: entitledIn(ENV_A) });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(columnsOf(observed.body)).toContain('alpha_only_field');
        expect(observed.acquired).toEqual([ENV_A]);
        // ...and NOT the control-plane protocol, which is a third distinct
        // answer precisely so this cannot silently be that instead.
        expect(labelOf(observed.body)).not.toBe('Control Plane Accounts');

        // ⭐ The same request with NO caller is refused — so C2's 200 is a
        // statement about an entitled caller and not about the route being
        // open. This is the anonymous floor the route did not have.
        const anonymous = await drive({ host: HOST_NEUTRAL, ctx: undefined });
        expect(anonymous.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(anonymous.code).toBe(ANONYMOUS_DENY_CODE);
        expect(labelOf(anonymous.body)).toBeUndefined();
    }, 120_000);

    it("C3 — the SCOPED mount, where naming an environment is declared and URL-visible, DOES deliver environment B's view", async () => {
        // ⭐ The control that makes a negative in §1/§2 meaningful. If the route
        // could never deliver B's body on this instrument, "no crossing" would
        // be a property of the harness rather than a reading about the code.
        const observed = await drive({
            route: UI_ROUTE_SCOPED,
            params: { environmentId: ENV_B, object: 'account', type: 'list' },
            host: HOST_NEUTRAL,
            ctx: entitledIn(ENV_B),
        });

        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');
        expect(columnsOf(observed.body)).toContain('beta_only_field');
        expect(observed.acquired).toEqual([ENV_B]);

        // ⭐ And the scoped mount is gated too — naming an environment in the
        // URL is no more of an entitlement than naming it in a header. A caller
        // anchored in A is refused the same URL.
        const foreign = await drive({
            route: UI_ROUTE_SCOPED,
            params: { environmentId: ENV_B, object: 'account', type: 'list' },
            host: HOST_NEUTRAL,
            ctx: entitledIn(ENV_A),
        });
        expect(foreign.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(foreign.body)).toBeUndefined();
    }, 120_000);

    it('C4 — the kernel-acquisition recorder is an observable, not a constant', async () => {
        const a = await drive({ host: HOST_A, ctx: entitledIn(ENV_A) });
        const b = await drive({
            route: UI_ROUTE_SCOPED,
            params: { environmentId: ENV_B, object: 'account', type: 'list' },
            ctx: entitledIn(ENV_B),
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
    it("⭐ an ANONYMOUS request naming environment B on an unscoped URL is REFUSED — it used to receive B's view", async () => {
        // ⚠️ 2026-08-29, on the unrepaired seam, this same drive answered 200
        // with `Beta Environment Accounts`, B's kernel ACQUIRED, and
        // `execCtxCalls` at 0. That was the finding. The assertions below are
        // its inverse, one for one.
        const observed = await drive({
            host: HOST_NEUTRAL,          // resolves to nothing → would fall to A
            environmentIdHeader: ENV_B,  // the only thing the caller supplies
            ctx: undefined,              // ⭐ no execution context whatsoever
        });

        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(observed.code).toBe(ANONYMOUS_DENY_CODE);

        // Three independent observations, inverted one for one:
        //   - NO view of any environment is in the body — not B's, and not the
        //     A baseline either, so this is a refusal and not a redirection;
        expect(labelOf(observed.body)).toBeUndefined();
        expect(columnsOf(observed.body)).toEqual([]);
        expect(JSON.stringify(observed.body)).not.toContain('Beta');
        expect(JSON.stringify(observed.body)).not.toContain('Alpha');
        //   - identity WAS asked for, which is the step the seam did not have;
        expect(observed.execCtxCalls).toBeGreaterThan(0);
        //   - ⚠️ and NO kernel is acquired on this path — which is NOT the
        //     reading that was predicted before this ran, so it is written down
        //     the way it came out. The prediction was that B's kernel would
        //     still be ACQUIRED before the refusal, because the deny sits at the
        //     seam after environment resolution, exactly as it does on the
        //     guarded sibling route §5 measures. That prediction is right about
        //     PRODUCTION and wrong about this instrument, and the difference is
        //     the instrument itself: `instrument()` replaces `resolveExecCtx`,
        //     so the only `getOrCreate` caller left on this path is
        //     `resolveProtocol` — which the repair moved to AFTER the refusal.
        //     Unstubbed, `computeExecCtx` acquires the named environment's
        //     kernel to look for its `auth` service, and that is measured
        //     against the real method in `ui-view-environment-ownership.test.ts`
        //     (`authLookups` records B before the default). ⛔ So this zero is a
        //     property of the stub and must not be read as "the ordering
        //     property the ruling put out of scope has been repaired" — it has
        //     not been, and repairing it is a separate card.
        expect(observed.acquired).toEqual([]);
    }, 120_000);

    it('⭐ POSITIVE CONTROL — a caller ENTITLED TO B naming B is served, so the refusal above is a decision', async () => {
        // Without this the whole section is satisfied by a route that refuses
        // everyone, which would be a different defect wearing the same green.
        const owner = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
        expect(owner.status).toBe(200);
        expect(labelOf(owner.body)).toBe('Beta Environment Accounts');
        expect(columnsOf(owner.body)).toContain('beta_only_field');
        expect(owner.acquired).toEqual([ENV_B]);

        // ...and the caller's ENTITLEMENT is what decides, not the mere
        // presence of a session: an authenticated caller anchored in A, naming
        // B, is refused. This is the case the rejected option B would have
        // served — anonymous-deny alone never compares the two environments.
        const outsider = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A) });
        expect(outsider.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(outsider.body)).toBeUndefined();
        expect(JSON.stringify(outsider.body)).not.toContain('Beta');
    }, 120_000);

    it('⭐ a header naming an environment the registry does NOT know is REFUSED, not answered with the default', async () => {
        // ⚠️ This case inverted the hardest, and it is the ruling's 「信号化拒绝」.
        // Before: an unknown id fell through `envRegistry.resolveById` to the
        // DEFAULT environment and answered 200 with A's view — a validation
        // failure served as a success. Now the caller named an environment the
        // chain did not serve, and that is refused.
        const observed = await drive({
            host: HOST_NEUTRAL,
            environmentIdHeader: 'env_ghost_does_not_exist',
            ctx: entitledIn(ENV_A),      // ⭐ a real caller, entitled to the default
        });

        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(observed.body)).toBeUndefined();
        // ⛔ Specifically NOT the default environment's view, which is the
        // silent fallback the ruling forbids.
        expect(labelOf(observed.body)).not.toBe('Alpha Environment Accounts');
        // The registry WAS consulted — the refusal is a decision, not a header
        // the server never looked at.
        expect(observed.idLookups).toContain('env_ghost_does_not_exist');

        // CONTROL: the same caller with no header is served the default
        // environment, so the refusal is caused by the unresolvable NAME and
        // not by this caller being unable to read anything.
        const noHeader = await drive({ host: HOST_NEUTRAL, ctx: entitledIn(ENV_A) });
        expect(noHeader.status).toBe(200);
        expect(labelOf(noHeader.body)).toBe('Alpha Environment Accounts');
    }, 120_000);

    it('a caller supplying nothing but the header — no cookie, no authorization, no session — gets the anonymous refusal', async () => {
        const observed = await drive({
            host: HOST_NEUTRAL,
            environmentIdHeader: ENV_B,
            ctx: undefined,
            headers: {}, // nothing added; the request carries `host` + the one header
        });
        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(observed.body)).toBeUndefined();
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 2. CHANNEL TWO — the request HOSTNAME. A separate answer from §1, and it is
//    measured separately because it may differ.
// ---------------------------------------------------------------------------

describe('[#13214] §2 channel: the request hostname', () => {
    it("⭐ an ANONYMOUS request whose hostname is bound to environment B is REFUSED — it used to receive B's view", async () => {
        // ⚠️ The hostname channel had the LOWER bar of the two: a Host header is
        // caller-controlled on any HTTP request and a tenant hostname is
        // typically public. On the unrepaired seam this answered 200 with B's
        // view, `execCtxCalls` at 0. Fixing only the header channel would have
        // left this open, which is why the ruling names both.
        const observed = await drive({ host: HOST_B, ctx: undefined });

        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(observed.code).toBe(ANONYMOUS_DENY_CODE);
        expect(labelOf(observed.body)).toBeUndefined();
        expect(JSON.stringify(observed.body)).not.toContain('Beta');
        expect(observed.execCtxCalls).toBeGreaterThan(0);
        // The hostname WAS resolved — the refusal is not "the host was ignored".
        expect(observed.hostnameLookups).toContain(HOST_B);
    }, 120_000);

    it('⭐ POSITIVE CONTROL — the hostname channel still SERVES the environment it is bound to, to a caller entitled there', async () => {
        const owner = await drive({ host: HOST_B, ctx: entitledIn(ENV_B) });
        expect(owner.status).toBe(200);
        expect(labelOf(owner.body)).toBe('Beta Environment Accounts');
        expect(owner.acquired).toEqual([ENV_B]);

        // ...and refuses a caller anchored in the OTHER environment reaching the
        // same public hostname. Ownership, not reachability, is the gate.
        const outsider = await drive({ host: HOST_B, ctx: entitledIn(ENV_A) });
        expect(outsider.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(outsider.body)).toBeUndefined();
    }, 120_000);

    it('⭐ CONTROL — the same channel answers with A when the hostname is bound to A, so it is bidirectional', async () => {
        const observed = await drive({ host: HOST_A, ctx: entitledIn(ENV_A) });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
    }, 120_000);

    it('⭐ NEGATIVE CONTROL — an unbound hostname does not cross; it falls to the default environment', async () => {
        const observed = await drive({ host: 'unbound.example.test', ctx: entitledIn(ENV_A) });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');
        expect(observed.acquired).toEqual([ENV_A]);
        expect(observed.hostnameLookups).toContain('unbound.example.test');
    }, 120_000);

    it('PRECEDENCE — hostname is still consulted BEFORE the header; a request naming BOTH is now refused rather than silently served one of them', async () => {
        // The mechanism is unchanged and still measured: a bound host wins and
        // the header is never looked up. What changed is the ANSWER to a
        // self-contradictory request. It used to be served environment A while
        // the caller asked for B — an answer about an environment the caller
        // did not name. Now a named environment that is not the one served is
        // refused, which is the same rule that closes the id oracle in §4.
        const observed = await drive({ host: HOST_A, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A) });
        expect(observed.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(observed.body)).toBeUndefined();
        // The header was never even looked up, which is the mechanism — the
        // refusal comes from the seam's comparison, not from the registry.
        expect(observed.idLookups).not.toContain(ENV_B);
        expect(observed.hostnameLookups).toContain(HOST_A);

        // CONTROL: drop the contradictory header and the same caller on the
        // same host is served, so the refusal is caused by the contradiction.
        const consistent = await drive({ host: HOST_A, ctx: entitledIn(ENV_A) });
        expect(consistent.status).toBe(200);
        expect(labelOf(consistent.body)).toBe('Alpha Environment Accounts');
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 3. WHAT THE ROUTE DISCLOSES — the inventory that was the blast radius
//
// ⚠️ These cases were written as the blast-radius reading for the CROSSING: an
// anonymous caller naming environment B, and what B handed it. The crossing is
// closed, so the same inventory is now taken on the OWNED path — the caller is
// entitled to B — because it is still the payload this route serves and a
// regression that re-opened the crossing would disclose exactly this.
// The FIRST case below is the crossing's own pin: a caller with no claim on B
// receives none of it.
// ---------------------------------------------------------------------------

describe('[#13214] §3 what the response contains, on the owned path and on the refused one', () => {
    it('⭐ THE PIN — a caller with no claim on environment B receives NONE of the inventory below', async () => {
        // One assertion per disclosure the crossing used to carry, stated as an
        // absence. This is the case that fails if any future change lets the
        // route answer a non-owner, whatever else stays green.
        const refused = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A) });
        const serialized = JSON.stringify(refused.body);

        expect(refused.status).toBe(ANONYMOUS_DENY_STATUS);
        // The object label, and every field label/name B declares.
        for (const disclosed of [
            'Beta Environment Accounts', 'Beta Account Name', 'Beta Only', 'Beta Status',
            'Beta Secret', 'beta_only_field', 'beta_secret',
        ]) {
            expect(serialized.includes(disclosed), `refusal carried \`${disclosed}\``).toBe(false);
        }
        expect(labelOf(refused.body)).toBeUndefined();
        expect(columnsOf(refused.body)).toEqual([]);

        // ⭐ CONTROL — every one of those strings IS present when the OWNER
        // asks, so the absences above are a refusal and not a fixture that
        // stopped producing.
        const owned = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
        const ownedSerialized = JSON.stringify(owned.body);
        expect(owned.status).toBe(200);
        for (const disclosed of ['Beta Environment Accounts', 'Beta Account Name', 'Beta Only', 'beta_only_field']) {
            expect(ownedSerialized.includes(disclosed), `owner did not receive \`${disclosed}\``).toBe(true);
        }
    }, 120_000);

    it('the list body is exactly the view envelope — object, view type, label, columns, sort, searchable fields', async () => {
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
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
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
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
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B),
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

    it('⭐ `hidden` IS a uniform floor on the crossed path — both field kinds measured, not assumed', async () => {
        // ⚠️ Read the history before the assertions: they were the other way
        // round two days ago, and that sequence is part of the record.
        //
        //   - #13244 measured this SINGLE-TENANT with ONE hidden field, which
        //     happened not to be a priority name, saw it dropped, and reported
        //     "hidden is dropped by declaration" — true of the field it drove,
        //     false of the class.
        //   - 2026-08-29, HERE: driven with BOTH kinds on the crossed path, the
        //     answer was NOT uniform. `beta_secret` (hidden, non-priority) was
        //     dropped; `status` (hidden, priority-named) was SERVED, carrying
        //     its authored label `Beta Status`. The producer's list branch
        //     applied `!fields[k].hidden` to the fill pass only and never to
        //     the priority pass, so two branches of one producer disagreed.
        //   - 2026-08-30: repaired by #13329 (`2a75270b1e`), which put the same
        //     filter on the priority pass. ⛔ The 2026-08-29 reading was not
        //     wrong — it was TRUE WHEN TAKEN and has been made false by a fix.
        //     Re-measured here on the repaired producer; the asymmetry is gone.
        //
        // ⭐ Why the case keeps its place now that it has changed colour.
        // #13329 ships its own pin
        // (`packages/metadata-protocol/src/protocol.ui-view-hidden-columns.test.ts`),
        // and that pin is the authority on the producer: it calls `getUiView`
        // DIRECTLY, in-package, from source, and sweeps all nine priority
        // names. ⛔ None of that is re-measured here. What it does not drive is
        // this file's subject: the CROSSED path — an anonymous request naming
        // environment B on the unscoped mount, through the REST seam, through
        // environment resolution and kernel acquisition, into the BUILT
        // `metadata-protocol` `dist/` (header note on aliasing). This case is
        // the blast-radius reading for the crossing: what the disclosure this
        // file measures actually contains. A regression reachable only through
        // that chain would leave the producer-level pin green.
        const observed = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
        const columns = columnsOf(observed.body);
        const labels = (observed.body.list.columns as any[]).map((c) => c.label);

        // Pinned to B first: an inventory of what environment B disclosed, not
        // of whatever the route happened to answer.
        expect(labelOf(observed.body)).toBe('Beta Environment Accounts');

        // Both kinds, named, because the class is what the repair moved:
        //   - `beta_secret` — hidden, NOT a priority name (dropped before too);
        //   - `status`      — hidden AND a priority name  (this was the defect).
        expect(columns).not.toContain('beta_secret');
        expect(columns).not.toContain('status');

        // The finding was never "a field name appears" — the emitted column
        // carried an authored human string. Neither label crosses now.
        expect(labels).not.toContain('Beta Status');
        expect(labels).not.toContain('Beta Secret');

        // ⭐ Controls. Without these, a producer that emitted NOTHING at all
        // would satisfy every assertion above vacuously.
        expect(columns).toContain('name');
        expect(columns).toContain('beta_only_field');
        expect(labels).toContain('Beta Account Name');

        // The name-agnostic form of the same statement, computed from the
        // fixture rather than from a copy of the producer's priority list: no
        // column the served body emits is declared hidden. A tenth priority
        // name added without the filter fails this even though nothing here
        // knows its spelling.
        const hiddenKeys = Object.keys(SCHEMA_B.fields)
            .filter((k) => (SCHEMA_B.fields as any)[k].hidden === true);
        expect(hiddenKeys).toEqual(['status', 'beta_secret']); // the fixture says what it says
        expect(columns.filter((c) => hiddenKeys.includes(c))).toEqual([]);

        // `searchableFields` is derived from `columns`, so a hidden column that
        // reached the body also reached the search affordance — a second
        // user-visible consequence of the same line, read on the crossed path.
        const searchable = observed.body.list.searchableFields as string[];
        expect(searchable.filter((f) => hiddenKeys.includes(f))).toEqual([]);

        // The form branch filtered every hidden field all along. Asserting the
        // two branches now AGREE is the other half of the repair, and it is
        // what would say so if a future change moved only one of them.
        const form = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B),
            params: { object: 'account', type: 'form' },
        });
        expect(formFieldsOf(form.body)).not.toContain('status');
        expect(formFieldsOf(form.body)).not.toContain('beta_secret');
        expect(formFieldsOf(form.body)).toContain('beta_only_field'); // control
    }, 120_000);

    it('⭐ the OBJECT-EXISTENCE ORACLE is closed for a non-owner — present and absent objects answer identically', async () => {
        // ⚠️ The second finding of the crossing, distinct from the payload: a
        // present object answered 200 and an absent one did not, so an
        // anonymous request could enumerate environment B's object namespace.
        // The discriminator is gone for anyone without a claim on B — the two
        // requests are refused with the SAME status and the SAME bytes.
        const presentToOutsider = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A),
        });
        const absentToOutsider = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A),
            params: { object: 'no_such_object_here', type: 'list' },
        });
        expect(presentToOutsider.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(absentToOutsider.status).toBe(presentToOutsider.status);
        expect(JSON.stringify(absentToOutsider.body)).toBe(JSON.stringify(presentToOutsider.body));

        // ⭐ CONTROL — the discriminator still EXISTS for the owner, so the
        // equality above is the outsider being refused and not the route having
        // lost the ability to tell the two objects apart.
        const presentToOwner = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B),
        });
        const absentToOwner = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B),
            params: { object: 'no_such_object_here', type: 'list' },
        });
        expect(presentToOwner.status).toBe(200);
        expect(labelOf(presentToOwner.body)).toBe('Beta Environment Accounts');
        expect(absentToOwner.status).not.toBe(200);
        expect(absentToOwner.acquired).toEqual([ENV_B]);
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
        // ⚠️ The header is dropped from this drive and that is deliberate. With
        // no registry the chain resolves NOTHING, so a request naming an
        // environment is now refused for naming one that was not served — a
        // true reading, but a different one from the wiring fact this case is
        // about. The header's own case is the last one in this section.
        const observed = await drive({
            host: HOST_B,
            ctx: entitledIn('anything'),
            wiring: { defaultEnvironmentId: undefined },
        });
        expect(observed.status).toBe(200);
        expect(labelOf(observed.body)).toBe('Control Plane Accounts');

        // ⭐ A control-plane boot resolves no environment, so there is nothing
        // to own and the anonymous floor is the whole gate — which the route
        // now has. Anonymous is refused here too.
        const anonymous = await drive({
            host: HOST_B, ctx: undefined, wiring: { defaultEnvironmentId: undefined },
        });
        expect(anonymous.status).toBe(ANONYMOUS_DENY_STATUS);
    }, 120_000);

    it('an envRegistry WITHOUT a kernelManager does not cross either — the chain needs both', async () => {
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_B,
            ctx: entitledIn(ENV_A),
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
            ctx: entitledIn(ENV_A),
            wiring: {
                envRegistry: shared.envRegistry,
                kernelManager: shared.kernelManager,
                defaultEnvironmentId: ENV_A,
                requestEnvResolver: { async resolveRequestEnvironmentId() { return ENV_A; } },
            },
        });
        expect(labelOf(observed.body)).toBe('Alpha Environment Accounts');

        // ...and the resolver's answer is what ownership is measured against:
        // the same host, the same resolver, a caller anchored in B instead — B
        // is not what was resolved, so it is refused.
        const anchoredElsewhere = await drive({
            host: HOST_B,
            ctx: entitledIn(ENV_B),
            wiring: {
                envRegistry: shared.envRegistry,
                kernelManager: shared.kernelManager,
                defaultEnvironmentId: ENV_A,
                requestEnvResolver: { async resolveRequestEnvironmentId() { return ENV_A; } },
            },
        });
        expect(anchoredElsewhere.status).toBe(ANONYMOUS_DENY_STATUS);
    }, 120_000);

    it('⭐ CONTROL — the same injected resolver CAN send the request to B, so the reading above is the resolver deciding, not a dead channel', async () => {
        const shared = tenantWiring();
        const observed = await drive({
            host: HOST_NEUTRAL,
            ctx: entitledIn(ENV_B),
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
        const degraded = {
            envRegistry: shared.envRegistry,
            kernelManager: shared.kernelManager,
            defaultEnvironmentId: ENV_A,
            requestEnvResolver: { async resolveRequestEnvironmentId() { throw new Error('resolver down'); } },
        };
        // The legacy chain is reached and the header still DECIDES the
        // environment — that mechanism is unchanged and still measured.
        const owner = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B), wiring: degraded,
        });
        expect(labelOf(owner.body)).toBe('Beta Environment Accounts');

        // ⭐ But a degraded resolver no longer degrades the GATE: the caller
        // still has to own what the legacy chain resolved. Before the repair
        // this drive with `ctx: undefined` answered 200 with B's view.
        const outsider = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A), wiring: degraded,
        });
        expect(outsider.status).toBe(ANONYMOUS_DENY_STATUS);
        const anonymous = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined, wiring: degraded,
        });
        expect(anonymous.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(labelOf(anonymous.body)).toBeUndefined();
    }, 120_000);

    it('⭐ the ENVIRONMENT-ID ORACLE is closed — a valid id and an invalid one now get BYTE-IDENTICAL answers', async () => {
        // ⚠️ This is the case that decided the refusal's SHAPE, and it is worth
        // reading before changing either.
        //
        // Before: the id was validated through `envRegistry.resolveById`, but
        // the failure was not signalled — an unknown id fell through to the
        // DEFAULT environment and answered 200 with that environment's view.
        // Two 200s with different bytes let a caller with no credential tell a
        // real environment id from an invented one, which is the difference
        // between "must possess an id" and "can discover one".
        //
        // ⭐ Closing it takes more than refusing: the two refusals have to be
        // INDISTINGUISHABLE. A caller naming a real foreign environment is
        // refused because their credential is not valid there; a caller naming
        // an invented one is refused because the chain served something else.
        // Two different reasons — one response, byte for byte. That is why
        // `enforceEnvironmentOwnership` answers with the anonymous-deny
        // envelope verbatim instead of minting a 403 or a 404 of its own: a
        // distinct status for either reason would rebuild the oracle one layer
        // up.
        const anonValid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: undefined });
        const anonInvalid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: 'env_not_real', ctx: undefined });
        expect(anonValid.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(anonInvalid.status).toBe(anonValid.status);
        expect(JSON.stringify(anonInvalid.body)).toBe(JSON.stringify(anonValid.body));

        // ...and for an AUTHENTICATED caller who owns neither of the two ids in
        // play. This leg is the one that would still leak if the refusals had
        // been given different statuses.
        const outsiderValid = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_A),
        });
        const outsiderInvalid = await drive({
            host: HOST_NEUTRAL, environmentIdHeader: 'env_not_real', ctx: entitledIn(ENV_A),
        });
        expect(outsiderValid.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(outsiderInvalid.status).toBe(outsiderValid.status);
        expect(JSON.stringify(outsiderInvalid.body)).toBe(JSON.stringify(outsiderValid.body));
        // ⛔ And neither is the silent default-environment answer.
        expect(labelOf(outsiderInvalid.body)).not.toBe('Alpha Environment Accounts');

        // ⭐ CONTROL — the registry IS still consulted for the valid id, so the
        // equality above is a refusal rather than a header nobody looked at;
        // and the OWNER of a valid id still gets a distinguishable answer, so
        // the route has not simply stopped resolving environments.
        expect(outsiderValid.idLookups).toContain(ENV_B);
        const ownerValid = await drive({ host: HOST_NEUTRAL, environmentIdHeader: ENV_B, ctx: entitledIn(ENV_B) });
        expect(ownerValid.status).toBe(200);
        expect(JSON.stringify(ownerValid.body)).not.toBe(JSON.stringify(outsiderValid.body));
    }, 120_000);

    it('⭐ the registrar body itself carries the three steps — read off the registrar, not off a grep of the file', () => {
        // The source half of the mechanism, scoped to the registrar so a
        // neighbour's code cannot satisfy it. ⚠️ Inverted: the two `false`
        // assertions here were the card's source-level finding.
        const start = SOURCE.indexOf('private registerUiEndpoints(');
        const end = SOURCE.indexOf('private registerCrudEndpoints(');
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const body = SOURCE.slice(start, end);

        expect(body).toContain("const isScoped = basePath.includes('/environments/:environmentId')");
        // The environment is decided ONCE, through the shared entry point, and
        // that one answer is what identity, ownership and the protocol all use.
        expect(body).toContain('this.resolveRequestEnvironmentId(routeEnvironmentId, req)');
        expect(body).toContain('this.resolveProtocol(environmentId, req)');
        // The three steps the seam did not have.
        expect(body).toContain('this.resolveExecCtx(environmentId, req)');
        expect(body).toContain('this.enforceAuth(req, res, context)');
        expect(body).toContain('this.enforceEnvironmentOwnership(req, res, environmentId, context)');

        // ⭐ ORDER, not just presence — anonymity is refused before ownership is
        // compared, and both before any protocol is resolved. A guard that ran
        // after the answer was produced would satisfy a presence check.
        expect(body.indexOf('this.resolveExecCtx(')).toBeLessThan(body.indexOf('this.enforceAuth('));
        expect(body.indexOf('this.enforceAuth(')).toBeLessThan(body.indexOf('this.enforceEnvironmentOwnership('));
        expect(body.indexOf('this.enforceEnvironmentOwnership(')).toBeLessThan(body.indexOf('this.resolveProtocol('));

        // ⛔ Reverse-checked: the same terms counted over the WHOLE file, so
        // these readings are about this registrar and not about a misspelling.
        expect(SOURCE.split('this.enforceAuth(').length - 1).toBeGreaterThan(40);
        expect(SOURCE.split('this.resolveExecCtx(').length - 1).toBeGreaterThan(40);
        // ...and the ownership guard is NOT sprayed across the file — it is a
        // single new call site plus its definition.
        expect(SOURCE.split('this.enforceEnvironmentOwnership(').length - 1).toBe(1);
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
