// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13214] The fact the ownership gate reads — pinned against its PRODUCER.
 *
 * ## Why this file has to exist separately
 *
 * `ui-view-route-tenancy.measurement.test.ts` and
 * `ui-view-route-identity.measurement.test.ts` drive the repaired seam through
 * an `instrument()` that replaces `resolveExecCtx` wholesale, so every
 * execution context in those files is SYNTHETIC — including the
 * `__authEnvironmentId` key that `enforceEnvironmentOwnership` compares. That
 * makes them complete readings about the GATE and no reading at all about the
 * FACT: if `computeExecCtx` stamped the key wrongly — or stamped the resolved
 * environment unconditionally, which is the tempting shortcut — every
 * assertion over there would stay green while the gate compared a value to
 * itself and could never refuse anyone.
 *
 * ⭐ That is the shape of an assertion which survives its own defect. This file
 * closes it by driving the UNSTUBBED method.
 *
 * ## What `__authEnvironmentId` means, and the branch that makes it non-trivial
 *
 * `computeExecCtx` resolves the request's environment, then looks up an `auth`
 * service to validate the caller against. It has three ways to find one, and
 * the SECOND does not belong to the resolved environment:
 *
 *   1. the resolved environment's own kernel                → anchored there;
 *   2. ⚠️ the DEFAULT environment's kernel, when (1) has no `auth` service
 *      → the credential is checked somewhere else entirely;
 *   3. the single-kernel `authServiceProvider`, asked for this environment.
 *
 * Branch 2 is the whole reason an ownership comparison is needed rather than
 * an anonymous check: a session minted in the default environment authenticates
 * a request naming another one, and before the repair nothing anywhere noticed.
 * §1 drives exactly that branch.
 */

import { describe, it, expect } from 'vitest';
import { ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import type { RestEnvRegistry, RestKernelManager } from './rest-server.js';

const BASE = '/api/v1';
const UI_ROUTE = `GET ${BASE}/ui/view/:object/:type`;

const ENV_A = 'env_alpha';
const ENV_B = 'env_beta';

const SCHEMA_A = {
    name: 'account',
    label: 'Alpha Environment Accounts',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Alpha Account Name' },
        alpha_only_field: { name: 'alpha_only_field', type: 'text', label: 'Alpha Only' },
    },
};

const SCHEMA_B = {
    name: 'account',
    label: 'Beta Environment Accounts',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Beta Account Name' },
        beta_only_field: { name: 'beta_only_field', type: 'text', label: 'Beta Only' },
    },
};

function protocolFor(schema: unknown): any {
    const engine = { registry: { getObject: (name: string) => (name === 'account' ? schema : null) } };
    return new ObjectStackProtocolImplementation(engine as any) as any;
}

/**
 * A minimal `objectql` the shared authz resolver can query without throwing.
 * Every lookup answers EMPTY, so the resolved principal carries the session's
 * user id and no roles — which is all these readings turn on.
 */
function emptyQl(): any {
    const empty = async () => [];
    return new Proxy({}, {
        get: (_t, k: string) => (k === 'then' ? undefined : empty),
    });
}

/** An auth service in the shape `computeExecCtx` normalises: `api.getSession`. */
function authServiceFor(userId: string): any {
    return {
        api: {
            getSession: async () => ({ user: { id: userId, email: `${userId}@example.test` }, session: { userId } }),
        },
    };
}

interface KernelSpec {
    /** `undefined` = this environment's kernel carries NO `auth` service. */
    authUserId?: string;
    schema: unknown;
}

function kernelManagerFor(spec: Record<string, KernelSpec>) {
    const acquired: string[] = [];
    const authLookups: string[] = [];
    const kernelManager: RestKernelManager = {
        async getOrCreate(environmentId: string) {
            acquired.push(environmentId);
            const entry = spec[environmentId];
            return {
                async getServiceAsync<T>(name: string): Promise<T> {
                    if (name === 'auth') {
                        authLookups.push(environmentId);
                        if (!entry?.authUserId) throw new Error(`no auth service in ${environmentId}`);
                        return authServiceFor(entry.authUserId) as T;
                    }
                    if (name === 'objectql') return emptyQl() as T;
                    if (name === 'protocol') return protocolFor(entry?.schema ?? null) as T;
                    // `i18n`, `tenancy`, `settings`, … — absent, which every
                    // caller in `computeExecCtx` treats as best-effort.
                    throw new Error(`no ${name} service`);
                },
            } as any;
        },
    };
    return { kernelManager, acquired, authLookups };
}

const envRegistry: RestEnvRegistry = {
    async resolveByHostname() { return null; },
    async resolveById(environmentId: string) {
        return environmentId === ENV_A || environmentId === ENV_B ? { driver: environmentId } : null;
    },
};

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

/**
 * ⭐ The arity/position pin, carried over from the tenancy harness for its
 * reason: a surplus argument still RUNS while shifting every later provider
 * onto the wrong parameter, and `kernelManager` / `envRegistry` are positions 4
 * and 5 — the two everything here turns on. Typed as the constructor's own
 * parameter list, so arity AND each position are checked by
 * `tsconfig.test.json`, which compiles this file.
 */
function makeServer(kernelManager: RestKernelManager, defaultEnvironmentId: string | undefined) {
    const server = recordingServer();
    const provider = async () => undefined as any;
    const args: ConstructorParameters<typeof RestServer> = [
        /*  1 server                       */ server,
        /*  2 protocol (control plane)     */ protocolFor(null),
        /*  3 config                       */ { api: { enableProjectScoping: true, projectResolution: 'auto' } },
        /*  4 kernelManager                */ kernelManager,
        /*  5 envRegistry                  */ envRegistry,
        /*  6 defaultEnvironmentIdProvider */ () => defaultEnvironmentId,
        /*  7 authServiceProvider          */ undefined,
        /*  8 objectQLProvider             */ provider,
        /*  9 emailServiceProvider         */ provider,
        /* 10 sharingServiceProvider       */ provider,
        /* 11 reportsServiceProvider       */ provider,
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
    return { rs, table: server.table as Map<string, Handler> };
}

function request(environmentIdHeader?: string) {
    return {
        params: { object: 'account', type: 'list' },
        query: {}, body: {}, method: 'GET',
        path: `${BASE}/ui/view/account/list`,
        url: `${BASE}/ui/view/account/list`,
        headers: {
            host: 'unbound.example.test',
            cookie: 'session=whatever',
            ...(environmentIdHeader ? { 'x-environment-id': environmentIdHeader } : {}),
        },
    } as any;
}

// ---------------------------------------------------------------------------
// 1. The FACT — `computeExecCtx` records where the credential was validated
// ---------------------------------------------------------------------------

describe('[#13214] §1 `__authEnvironmentId` names the environment that actually validated the caller', () => {
    it("is the RESOLVED environment when that environment's own kernel carries the auth service", async () => {
        const { kernelManager } = kernelManagerFor({
            [ENV_A]: { authUserId: 'u_alpha', schema: SCHEMA_A },
            [ENV_B]: { authUserId: 'u_beta', schema: SCHEMA_B },
        });
        const { rs } = makeServer(kernelManager, ENV_A);

        const ctx = await rs.resolveExecCtx(undefined, request(ENV_B));
        expect(ctx?.userId).toBe('u_beta');
        expect(ctx.__authEnvironmentId).toBe(ENV_B);
    }, 120_000);

    it('⭐ is the DEFAULT environment — NOT the resolved one — when the resolved kernel has no auth service', async () => {
        // ⚠️ THE branch the whole gate exists for. The request resolves to B,
        // B's kernel has no `auth` service, so the credential is validated
        // against A's. The caller IS authenticated — and authenticated
        // somewhere other than where the answer would come from.
        const { kernelManager, authLookups } = kernelManagerFor({
            [ENV_A]: { authUserId: 'u_alpha', schema: SCHEMA_A },
            [ENV_B]: { schema: SCHEMA_B },   // no auth service
        });
        const { rs } = makeServer(kernelManager, ENV_A);

        const req = request(ENV_B);
        // The environment really did resolve to B — stated as its own reading,
        // so "anchored in A" cannot be read as "never resolved B".
        expect(await rs.resolveRequestEnvironmentId(undefined, req)).toBe(ENV_B);

        const ctx = await rs.resolveExecCtx(undefined, req);
        expect(ctx?.userId).toBe('u_alpha');
        // ⭐ Truthful, not convenient: it names A, so the comparison downstream
        // can fail. Stamping the resolved environment here would make the gate
        // compare a value to itself and refuse no one, with every gate-level
        // test still green.
        expect(ctx.__authEnvironmentId).toBe(ENV_A);
        expect(ctx.__authEnvironmentId).not.toBe(ENV_B);
        // The mechanism: B's auth lookup was attempted and failed, then A's ran.
        expect(authLookups).toEqual([ENV_B, ENV_A]);
    }, 120_000);

    it('with NO auth service anywhere there is no context at all, so there is nothing to anchor', async () => {
        // The floor case, and the control for the two above: `undefined` is
        // what an unauthenticated resolution yields, and `enforceAuth` turns
        // that into the 401 — so `__authEnvironmentId` is only ever read on a
        // context that exists.
        const { kernelManager } = kernelManagerFor({
            [ENV_A]: { schema: SCHEMA_A },   // no auth service
            [ENV_B]: { schema: SCHEMA_B },   // no auth service
        });
        const { rs } = makeServer(kernelManager, ENV_A);
        expect(await rs.resolveExecCtx(undefined, request(ENV_B))).toBeUndefined();
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 2. The GATE, end to end, with NOTHING stubbed
// ---------------------------------------------------------------------------

describe('[#13214] §2 the seam refuses a caller authenticated in another environment — unstubbed', () => {
    async function drive(kernelManager: RestKernelManager, defaultEnvironmentId: string, header?: string) {
        const { rs, table } = makeServer(kernelManager, defaultEnvironmentId);
        rs.registerRoutes();
        const handler = table.get(UI_ROUTE);
        if (!handler) throw new Error(`route not mounted: ${UI_ROUTE}`);
        let status = 0; let body: any; let sent = false;
        const res: any = {
            status(c: number) { status = c; return res; },
            json(b: any) { body = b; sent = true; },
            send() { sent = true; }, header() { return res; }, setHeader() { return res; },
            end() { sent = true; }, write() { return true; }, type() { return res; },
        };
        await handler(request(header), res);
        return { status: status || (sent ? 200 : 0), body };
    }

    it('⭐ a caller validated in A, naming B, is REFUSED — and receives none of B', async () => {
        const wiring = kernelManagerFor({
            [ENV_A]: { authUserId: 'u_alpha', schema: SCHEMA_A },
            [ENV_B]: { schema: SCHEMA_B },   // no auth service → the crossing branch
        });
        const refused = await drive(wiring.kernelManager, ENV_A, ENV_B);

        expect(refused.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(JSON.stringify(refused.body)).not.toContain('Beta');
        // ⛔ And NOT the default environment's view either — a refusal, not a
        // redirection to whatever the caller does hold.
        expect(JSON.stringify(refused.body)).not.toContain('Alpha');

        // ⚠️ RECORDED, NOT REPAIRED — the ordering property the 2026-08-30
        // ruling names as input knowledge and puts out of this card's scope.
        // The foreign environment's kernel IS materialised before the refusal,
        // because identity resolution has to find an `auth` service and the
        // deny sits after environment resolution. This is the unstubbed
        // reading; the tenancy suite's `acquired` stays empty there only
        // because it replaces `resolveExecCtx` wholesale.
        expect(wiring.acquired).toContain(ENV_B);
        expect(wiring.authLookups[0]).toBe(ENV_B);
    }, 120_000);

    it('⭐ POSITIVE CONTROL — the same caller, naming their OWN environment, is served', async () => {
        // Without this the case above is satisfied by a boot that refuses
        // everything, which is a different defect wearing the same green.
        const { kernelManager } = kernelManagerFor({
            [ENV_A]: { authUserId: 'u_alpha', schema: SCHEMA_A },
            [ENV_B]: { schema: SCHEMA_B },
        });
        const served = await drive(kernelManager, ENV_A, ENV_A);

        expect(served.status).toBe(200);
        expect(served.body?.list?.label).toBe('Alpha Environment Accounts');
        expect((served.body.list.columns as any[]).map((c) => c.field)).toContain('alpha_only_field');
    }, 120_000);

    it('⭐ POSITIVE CONTROL — a caller validated IN B, naming B, is served B', async () => {
        // The other direction: when B carries its own auth service the
        // credential anchors there and the same URL is served. So the refusal
        // above is about WHERE the caller was validated, not about B being
        // unreachable through this route.
        const { kernelManager } = kernelManagerFor({
            [ENV_A]: { authUserId: 'u_alpha', schema: SCHEMA_A },
            [ENV_B]: { authUserId: 'u_beta', schema: SCHEMA_B },
        });
        const served = await drive(kernelManager, ENV_A, ENV_B);

        expect(served.status).toBe(200);
        expect(served.body?.list?.label).toBe('Beta Environment Accounts');
        expect((served.body.list.columns as any[]).map((c) => c.field)).toContain('beta_only_field');
    }, 120_000);
});
