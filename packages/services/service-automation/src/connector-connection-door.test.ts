// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0143 D3–D6 — connecting an `oauth2` `authorization_code` instance, end to
 * end: the connection record on a real ObjectQL over SQLite (so the
 * `Field.secret` seam is the engine's), a real token endpoint on a local HTTP
 * server, and a provider that asks the credential handle on every request.
 *
 *  - D3: one row per organization and instance; the refresh token encrypted
 *    and masked; the access token never stored;
 *  - D4: per-dispatch refresh, once on a 401; `invalid_grant` → "reconnect
 *    required"; an unreachable token endpoint → CONNECTOR_UPSTREAM_UNAVAILABLE;
 *    never authorized → "not connected", never a failed boot; the connection
 *    selected by the run's organization;
 *  - D5: state and PKCE bound to the user and organization that began the
 *    connect, single use; the redirect URI fixed per deployment;
 *  - D6: a grant is never a sign-in account;
 *  - no token, code, verifier or client secret in a log line, a descriptor,
 *    a degraded reason, a door answer, an engine read, or `sys_metadata`.
 *
 * The values below are obvious dummies.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { collectMaskedReadFields } from '@objectstack/objectql/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { callWithBorrowedCredential } from '@objectstack/types';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { Connector, ConnectorProviderContext, ConnectorProviderFactory } from '@objectstack/spec/integration';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { SysConnectorCredential } from './sys-connector-credential.object.js';
import { SysConnectorConnection } from './sys-connector-connection.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import { CONNECTOR_CONNECTION_OBJECT } from './connector-connections.js';

const CLIENT_SECRET = 'dummy-client-secret-26702';
const GOOD_CODE = 'dummy-code-26702';
const REDIRECT_URI = 'https://app.example.com/api/v1/automation/connectors/oauth/callback';
const SYSTEM = { isSystem: true } as const;
const ADMIN_A = { userId: 'usr_admin', tenantId: 'org_a' };
const ADMIN_B = { userId: 'usr_admin', tenantId: 'org_b' };

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── The authorization server ────────────────────────────────────────

interface TokenRequest {
    authorization?: string;
    form: Record<string, string>;
}

const idp = {
    server: undefined as Server | undefined,
    url: '',
    requests: [] as TokenRequest[],
    /** Answer to a refresh_token grant; default rotate. */
    refresh: 'rotate' as 'rotate' | 'invalid_grant' | 'down' | 'no_rotate',
    issued: 0,
};

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => resolve(body));
    });
}

beforeAll(async () => {
    idp.server = createServer(async (req, res) => {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        idp.requests.push({ authorization: req.headers.authorization, form });
        const answer = (status: number, body: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        idp.issued += 1;
        const n = idp.issued;
        if (form.grant_type === 'authorization_code') {
            if (form.code !== GOOD_CODE) return answer(400, { error: 'invalid_grant' });
            return answer(200, {
                access_token: `dummy-at-exchange-${n}`, token_type: 'Bearer', expires_in: 3600, refresh_token: `dummy-rt-${n}`, scope: 'crm.read',
            });
        }
        if (form.grant_type === 'refresh_token') {
            if (idp.refresh === 'down') return answer(503, {});
            if (idp.refresh === 'invalid_grant') return answer(400, { error: 'invalid_grant', error_description: `${form.refresh_token} revoked` });
            return answer(200, {
                access_token: `dummy-at-refresh-${n}`,
                token_type: 'Bearer',
                expires_in: 3600,
                ...(idp.refresh === 'rotate' ? { refresh_token: `dummy-rt-${n}` } : {}),
            });
        }
        return answer(400, { error: 'unsupported_grant_type' });
    });
    await new Promise<void>((r) => idp.server!.listen(0, '127.0.0.1', () => r()));
    idp.url = `http://127.0.0.1:${(idp.server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((r) => idp.server!.close(() => r()));
});

// ─── The deployment ──────────────────────────────────────────────────

function fakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
        },
        async decrypt(handle: CryptoHandle): Promise<string> {
            return [...handle.ciphertext].reverse().join('');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest: (plain: string) => `d:${plain.length}`,
        keyedDigest: async (plain: string) => `k:${plain.length}`,
    };
}

/** The declared `authorization_code` instance. */
function crm(over: Record<string, unknown> = {}) {
    return {
        name: 'crm',
        label: 'CRM',
        type: 'api',
        provider: 'granted',
        providerConfig: {},
        auth: {
            type: 'oauth2',
            grant: 'authorization_code',
            authorizationUrl: 'https://idp.example.com/authorize',
            tokenUrl: `${idp.url}/token`,
            clientId: 'client-26702',
            credentialRef: 'CRM_CLIENT_SECRET',
            scopes: ['crm.read'],
        },
        _packageId: 'com.example.crm',
        ...over,
    };
}

/**
 * A provider in the shape S2's will have: registered as asking the handle, and
 * every request presents what `callWithBorrowedCredential` hands it for the
 * run's organization. The upstream accepts the tokens in `accepted` (every
 * token, when it is `undefined`) and records what it was sent.
 */
function grantedProvider() {
    const state = {
        materialized: [] as ConnectorProviderContext[],
        sent: [] as string[],
        accepted: undefined as Set<string> | undefined,
    };
    const factory: ConnectorProviderFactory = (ctx) => {
        state.materialized.push(ctx);
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'request', label: 'Request' }],
            } as unknown as Connector,
            handlers: {
                request: async (_input, actionCtx) => callWithBorrowedCredential(
                    ctx.credentialHandle!,
                    async (auth) => {
                        const token = auth.type === 'bearer' ? auth.token : '';
                        state.sent.push(token);
                        return state.accepted === undefined || state.accepted.has(token)
                            ? { status: 200, ok: true }
                            : { status: 401, ok: false };
                    },
                    { organizationId: (actionCtx as { automation?: { tenantId?: string } })?.automation?.tenantId },
                ),
            },
        };
    };
    return { factory, state };
}

const engines: ObjectQL[] = [];
const kernels: LiteKernel[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
    idp.requests.length = 0;
    idp.refresh = 'rotate';
    idp.issued = 0;
    vi.restoreAllMocks();
});

function captureOutput(): { text: () => string } {
    const chunks: string[] = [];
    const keep = ((c: string | Uint8Array) => { chunks.push(String(c)); return true; }) as never;
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    vi.spyOn(process.stderr, 'write').mockImplementation(keep);
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
    }
    return { text: () => chunks.join('\n') };
}

async function dataEngine(): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    for (const object of [SysSecret, SysConnectorCredential, SysFlowCredential, SysConnectorConnection]) {
        (ql as any).registry.registerObject(object as never, 'test');
    }
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    return ql;
}

async function boot(declared: unknown[] = [crm()], opts: { redirectUri?: string | null; cluster?: unknown } = {}) {
    const ql = await dataEngine();
    const provider = grantedProvider();
    const kernel = new LiteKernel({ logger: { level: 'debug', format: 'json' } } as never);
    kernels.push(kernel);
    kernel.use(new AutomationServicePlugin({
        suspendedRunStore: 'memory',
        credentialResolver: (ref) => (ref === 'CRM_CLIENT_SECRET' ? CLIENT_SECRET : undefined),
        ...(opts.redirectUri === null ? {} : { connectorOAuthRedirectUri: opts.redirectUri ?? REDIRECT_URI }),
    }));
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            ctx.registerService('data', ql);
            if (opts.cluster) ctx.registerService('cluster', opts.cluster);
            ctx.getService('automation').registerConnectorProvider('granted', provider.factory, { credentialHandle: true });
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    const call = async (organizationId?: string) => engine.resolveConnectorAction('crm', 'request')!(
        {},
        { automation: organizationId === undefined ? {} : { tenantId: organizationId } } as never,
    );
    /** Begin as `context`, and complete as `as` (default the same caller) with `query` over the state. */
    const connect = async (context = ADMIN_A, opts2: { as?: typeof ADMIN_A; code?: string; query?: Record<string, string> } = {}) => {
        const begun = await engine.beginConnectorConnection({ connector: 'crm', context: context as never });
        const state = new URL(begun.authorizationUrl).searchParams.get('state')!;
        const query = opts2.query ?? { code: opts2.code ?? GOOD_CODE, state };
        return { begun, state, done: () => engine.completeConnectorConnection({ query: { state, ...query }, context: (opts2.as ?? context) as never }) };
    };
    return { ql, engine, provider, call, connect, kernel };
}

const rowsOf = async (ql: ObjectQL) => (await ql.find(CONNECTOR_CONNECTION_OBJECT, { context: SYSTEM } as never)) as any[];

// ─── D4 boot, D5 flow ────────────────────────────────────────────────

describe('ADR-0143 D4/D5 — connect an instance nobody authorized yet', () => {
    it('boots degraded "not connected"; begin → callback → connected and dispatching, no restart', async () => {
        const { engine, provider, call, connect, ql } = await boot();
        // Never authorized: degraded, named, the factory never asked — and the boot did not fail.
        expect(provider.state.materialized).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('crm')).toContain("connector instance 'crm' is not connected");
        expect(await engine.getConnectorConnection({ connector: 'crm', context: ADMIN_A as never }))
            .toEqual({ connector: 'crm', organizationId: 'org_a', status: 'not_connected' });

        const { begun, done } = await connect();
        const url = new URL(begun.authorizationUrl);
        expect(url.origin + url.pathname).toBe('https://idp.example.com/authorize');
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('client_id')).toBe('client-26702');
        expect(url.searchParams.get('scope')).toBe('crm.read');
        expect(begun).toMatchObject({ connector: 'crm', organizationId: 'org_a', expiresAt: expect.any(String) });
        // Beginning writes nothing to the connection record.
        expect(await rowsOf(ql)).toHaveLength(0);

        const state = await done();
        expect(state).toMatchObject({ connector: 'crm', organizationId: 'org_a', status: 'connected', scopes: 'crm.read', connectedBy: 'usr_admin' });

        // The code exchange: the client authenticated with Basic, the verifier
        // is the one whose S256 the authorization request carried, and the
        // redirect URI is repeated (RFC 6749 §4.1.3).
        expect(idp.requests).toHaveLength(1);
        const exchange = idp.requests[0];
        expect(exchange.authorization).toBe(`Basic ${Buffer.from(`client-26702:${CLIENT_SECRET}`).toString('base64')}`);
        expect(exchange.form).toMatchObject({ grant_type: 'authorization_code', code: GOOD_CODE, redirect_uri: REDIRECT_URI });
        expect(createHash('sha256').update(exchange.form.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));

        // Materialized with the handle and no static auth; the first dispatch
        // presents the access token the exchange answered (no refresh).
        expect(engine.getConnectorDegradedReason('crm')).toBeUndefined();
        expect(provider.state.materialized).toHaveLength(1);
        expect(provider.state.materialized[0].auth).toBeUndefined();
        expect(await call('org_a')).toMatchObject({ status: 200 });
        expect(provider.state.sent).toEqual(['dummy-at-exchange-1']);
        expect(idp.requests).toHaveLength(1);

        // One row: the refresh token masked on the engine's read, revision 1.
        const rows = await rowsOf(ql);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ organization_id: 'org_a', connector_name: 'crm', status: 'connected', revision: 1 });
        expect(rows[0].refresh_token).not.toBe('dummy-rt-1');
        expect(await (ql as any).resolveSecretField(CONNECTOR_CONNECTION_OBJECT, rows[0].id, 'refresh_token')).toBe('dummy-rt-1');
    });

    it('⛔ a callback completed by another user, or in another organization, is refused before its code is used', async () => {
        const { engine, connect, ql } = await boot();
        for (const as of [{ userId: 'usr_attacker', tenantId: 'org_a' }, ADMIN_B]) {
            const { done } = await connect(ADMIN_A, { as });
            await expect(done()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        }
        expect(idp.requests).toHaveLength(0);
        expect(await rowsOf(ql)).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('crm')).toContain('is not connected');
    });

    it('⛔ a state is used once: a replayed callback is refused, and so is a state never begun', async () => {
        const { engine, connect } = await boot();
        const { done, state } = await connect();
        await done();
        await expect(done()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('already used') });
        await expect(engine.completeConnectorConnection({ query: { state: `${state}x`, code: GOOD_CODE }, context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400 });
        await expect(engine.completeConnectorConnection({ query: { code: GOOD_CODE }, context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('carries no state') });
        expect(idp.requests).toHaveLength(1);
    });

    it('⛔ an expired state is refused', async () => {
        const { connect } = await boot();
        const { done } = await connect();
        const later = Date.now() + 601_000;
        vi.spyOn(Date, 'now').mockReturnValue(later);
        await expect(done()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('expired') });
        expect(idp.requests).toHaveLength(0);
    });

    it("an `error` answer is refused naming only a registered code — never the server's own text — and connects nothing", async () => {
        const { connect, ql } = await boot();
        const denied = await (await connect(ADMIN_A, { query: { error: 'access_denied', error_description: 'dummy-echo-text' } })).done()
            .catch((e) => e);
        expect(denied).toMatchObject({ status: 400 });
        expect(denied.message).toContain('(access_denied)');
        expect(denied.message).not.toContain('dummy-echo-text');
        const odd = await (await connect(ADMIN_A, { query: { error: 'dummy-unregistered-code' } })).done().catch((e) => e);
        expect(odd.message).not.toContain('dummy-unregistered-code');
        const bad = await (await connect(ADMIN_A, { code: 'dummy-wrong-code' })).done().catch((e) => e);
        expect(bad).toMatchObject({ status: 400, message: expect.stringContaining('refused the code (invalid_grant)') });
        expect(await rowsOf(ql)).toHaveLength(0);
    });

    it('the door refuses what has no connection to make, an unknown instance, a caller with no organization or no user', async () => {
        const clientCredentials = crm({ name: 'svc', auth: { ...crm().auth, grant: 'client_credentials', authorizationUrl: undefined } });
        const { engine } = await boot([crm(), clientCredentials]);
        await expect(engine.beginConnectorConnection({ connector: 'svc', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('does not use the oauth2 authorization_code grant') });
        await expect(engine.beginConnectorConnection({ connector: 'nope', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 404 });
        await expect(engine.beginConnectorConnection({ connector: 'crm', context: { userId: 'usr_admin' } as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('needs an active organization') });
        await expect(engine.beginConnectorConnection({ connector: 'crm', context: { tenantId: 'org_a' } as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('needs a signed-in user') });
    });

    it('the redirect URI is fixed per deployment: with none configured, begin is a 503 and is never taken from the request', async () => {
        const saved = { a: process.env.OS_AUTH_URL, b: process.env.OS_BASE_URL };
        delete process.env.OS_AUTH_URL;
        delete process.env.OS_BASE_URL;
        try {
            const { engine } = await boot([crm()], { redirectUri: null });
            await expect(engine.beginConnectorConnection({ connector: 'crm', context: ADMIN_A as never }))
                .rejects.toMatchObject({ status: 503, message: expect.stringContaining('never taken from the request') });
            process.env.OS_BASE_URL = 'https://os.example.com/';
            const begun = await engine.beginConnectorConnection({ connector: 'crm', context: ADMIN_A as never });
            expect(new URL(begun.authorizationUrl).searchParams.get('redirect_uri'))
                .toBe('https://os.example.com/api/v1/automation/connectors/oauth/callback');
        } finally {
            if (saved.a === undefined) delete process.env.OS_AUTH_URL; else process.env.OS_AUTH_URL = saved.a;
            if (saved.b === undefined) delete process.env.OS_BASE_URL; else process.env.OS_BASE_URL = saved.b;
        }
    });
});

// ─── D4 dispatch ─────────────────────────────────────────────────────

describe('ADR-0143 D4 — dispatch with the connection', () => {
    it('a 401 refreshes once and retries; a rotated refresh token is stored atomically under a new revision', async () => {
        const { call, connect, provider, ql } = await boot();
        await (await connect()).done();
        provider.state.accepted = new Set(['dummy-at-refresh-2']);
        expect(await call('org_a')).toMatchObject({ status: 200 });
        expect(provider.state.sent).toEqual(['dummy-at-exchange-1', 'dummy-at-refresh-2']);
        expect(idp.requests[1].form).toEqual({ grant_type: 'refresh_token', refresh_token: 'dummy-rt-1' });
        const [row] = await rowsOf(ql);
        expect(row.revision).toBe(2);
        expect(await (ql as any).resolveSecretField(CONNECTOR_CONNECTION_OBJECT, row.id, 'refresh_token')).toBe('dummy-rt-2');
    });

    it('a token past its expiry (less the skew margin) is refreshed before it is sent', async () => {
        const { call, connect, provider } = await boot();
        await (await connect()).done();
        const later = Date.now() + 3_600_000;
        vi.spyOn(Date, 'now').mockReturnValue(later);
        await call('org_a');
        expect(provider.state.sent).toEqual(['dummy-at-refresh-2']);
    });

    it('an unreachable token endpoint is CONNECTOR_UPSTREAM_UNAVAILABLE and the connection stays connected', async () => {
        const { call, connect, provider, engine, ql } = await boot();
        await (await connect()).done();
        provider.state.accepted = new Set();
        idp.refresh = 'down';
        await expect(call('org_a')).rejects.toMatchObject({ code: 'CONNECTOR_UPSTREAM_UNAVAILABLE' });
        expect((await rowsOf(ql))[0].status).toBe('connected');
        expect(engine.getConnectorDegradedReason('crm')).toBeUndefined();
    });

    it('a refused grant degrades the instance "reconnect required"; a reconnect brings it back', async () => {
        const { call, connect, provider, engine, ql } = await boot();
        await (await connect()).done();
        provider.state.accepted = new Set();
        idp.refresh = 'invalid_grant';
        await expect(call('org_a')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Reconnect required') });
        await vi.waitFor(() => expect(engine.getConnectorDegradedReason('crm')).toContain("needs to be reconnected for organization 'org_a'"));
        const [row] = await rowsOf(ql);
        expect(row).toMatchObject({ status: 'reconnect_required' });
        expect(await (ql as any).resolveSecretField(CONNECTOR_CONNECTION_OBJECT, row.id, 'refresh_token')).toBeNull();
        expect(await engine.getConnectorConnection({ connector: 'crm', context: ADMIN_A as never }))
            .toMatchObject({ status: 'reconnect_required', statusReason: expect.stringContaining('Reconnect required') });

        idp.refresh = 'rotate';
        provider.state.accepted = undefined;
        await (await connect()).done();
        expect(engine.getConnectorDegradedReason('crm')).toBeUndefined();
        expect(await call('org_a')).toMatchObject({ status: 200 });
        expect((await rowsOf(ql))[0]).toMatchObject({ status: 'connected', revision: 2 });
    });

    it("the run's organization selects the connection; a run with none is refused when several exist", async () => {
        const { call, connect, provider } = await boot();
        await (await connect(ADMIN_A)).done();
        await (await connect(ADMIN_B)).done();
        await call('org_b');
        await call('org_a');
        expect(provider.state.sent).toEqual(['dummy-at-exchange-2', 'dummy-at-exchange-1']);
        await expect(call()).rejects.toMatchObject({ status: 422, message: expect.stringContaining('connected for 2 organizations') });
        await expect(call('org_c')).rejects.toMatchObject({ status: 503, message: expect.stringContaining("not connected for organization 'org_c'") });
    });

    it('revoke removes the connection and holds the instance "not connected" again; a second revoke is a 404', async () => {
        const { call, connect, engine, ql } = await boot();
        await (await connect()).done();
        expect(await engine.revokeConnectorConnection({ connector: 'crm', context: ADMIN_A as never }))
            .toEqual({ connector: 'crm', organizationId: 'org_a', status: 'not_connected' });
        expect(await rowsOf(ql)).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('crm')).toContain('is not connected');
        expect(engine.resolveConnectorAction('crm', 'request')).toBeUndefined();
        await expect(engine.revokeConnectorConnection({ connector: 'crm', context: ADMIN_A as never })).rejects.toMatchObject({ status: 404 });
        void call;
    });

    it('with a cluster service: a begun connect waits in its KV (any replica completes it) and a refresh runs under its lock', async () => {
        const kvHeld = new Map<string, { value: unknown; version: number }>();
        const lockKeys: string[] = [];
        const cluster = {
            kv: {
                async set(key: string, value: unknown) { kvHeld.set(key, { value, version: kvHeld.size + 1 }); },
                async get(key: string) { return kvHeld.get(key); },
                async delete(key: string, opts?: { ifVersion?: number }) {
                    const e = kvHeld.get(key);
                    if (!e || (opts?.ifVersion !== undefined && e.version !== opts.ifVersion)) return false;
                    return kvHeld.delete(key);
                },
            },
            lock: {
                async withLock(key: string, fn: () => Promise<unknown>) { lockKeys.push(key); return fn(); },
            },
        };
        const { call, connect, provider } = await boot([crm()], { cluster });
        const { done, state } = await connect();
        expect(kvHeld.size).toBe(1);
        expect([...kvHeld.keys()][0]).not.toContain(state);
        await done();
        expect(kvHeld.size).toBe(0);
        provider.state.accepted = new Set(['dummy-at-refresh-2']);
        await call('org_a');
        expect(lockKeys).toEqual(['connector-connection:crm:org_a:refresh']);
    });
});

// ─── No leak, D6 ─────────────────────────────────────────────────────

describe('ADR-0143 D3/D6 — what a grant leaves behind', () => {
    it('⛔ no token, code, verifier or client secret in a log line, a descriptor, a reason, a door answer or an engine read', async () => {
        const out = captureOutput();
        const { engine, call, connect, provider, ql } = await boot();
        const { begun, done } = await connect();
        const answers = [JSON.stringify(begun.organizationId), JSON.stringify(await done())];
        provider.state.accepted = new Set(['dummy-at-refresh-2']);
        await call('org_a');
        idp.refresh = 'invalid_grant';
        provider.state.accepted = new Set();
        await call('org_a').catch((e) => answers.push(String(e.message)));
        await vi.waitFor(() => expect(engine.getConnectorDegradedReason('crm')).toBeDefined());
        answers.push(JSON.stringify(await engine.getConnectorConnection({ connector: 'crm', context: ADMIN_A as never })));
        const verifier = idp.requests[0].form.code_verifier;

        const surfaces = {
            logs: out.text(),
            descriptors: JSON.stringify(engine.getConnectorDescriptors()),
            reason: String(engine.getConnectorDegradedReason('crm')),
            answers: answers.join('\n'),
            'engine read': JSON.stringify(await rowsOf(ql)),
        };
        for (const [where, text] of Object.entries(surfaces)) {
            for (const secret of [CLIENT_SECRET, GOOD_CODE, verifier, 'dummy-rt-1', 'dummy-rt-2', 'dummy-at-exchange-1', 'dummy-at-refresh-2']) {
                expect(text.includes(secret), `${where} carries ${secret}`).toBe(false);
            }
        }
        // The logs did record the connect — the pin is not passing on silence.
        expect(out.text()).toContain("connector instance 'crm' connected for organization 'org_a' by user 'usr_admin'");
        expect(out.text()).toContain("refused the grant of organization 'org_a'");
    });

    it('⛔ writes only its own record — never sys_metadata, never a sign-in account (D6) — and reads no account either', async () => {
        const writes: string[] = [];
        const reads: string[] = [];
        const { connect, call, provider, ql, engine } = await boot();
        for (const method of ['insert', 'update', 'delete'] as const) {
            const real = (ql as any)[method].bind(ql);
            vi.spyOn(ql as any, method).mockImplementation((object: unknown, ...rest: unknown[]) => {
                writes.push(String(object));
                return real(object, ...rest);
            });
        }
        const realFind = (ql as any).find.bind(ql);
        vi.spyOn(ql as any, 'find').mockImplementation((object: unknown, ...rest: unknown[]) => {
            reads.push(String(object));
            return realFind(object, ...rest);
        });
        await (await connect()).done();
        provider.state.accepted = new Set(['dummy-at-refresh-2']);
        await call('org_a');
        await engine.revokeConnectorConnection({ connector: 'crm', context: ADMIN_A as never });

        expect(writes.length).toBeGreaterThan(0);
        expect(new Set(writes.filter((o) => o !== 'sys_secret'))).toEqual(new Set([CONNECTOR_CONNECTION_OBJECT]));
        for (const object of [...writes, ...reads]) {
            expect(object).not.toMatch(/metadata|account|session|user/);
        }
    });

    it('the refresh token is the one masked field, so the audit copy masks it; the object has no data door', () => {
        expect(collectMaskedReadFields(SysConnectorConnection as never)).toEqual(['refresh_token']);
        expect(SysConnectorConnection.enable).toMatchObject({ apiEnabled: false, apiMethods: [] });
        expect(Object.keys(SysConnectorConnection.fields)).not.toContain('access_token');
    });
});
