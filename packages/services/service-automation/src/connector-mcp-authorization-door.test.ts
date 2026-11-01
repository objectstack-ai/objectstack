// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0143 D2.1 — connecting a `provider: 'mcp'` instance over http that
 * leaves its OAuth endpoints, or its client, to the MCP authorization flow:
 * protected-resource metadata (RFC 9728), authorization-server metadata
 * (RFC 8414), dynamic client registration (RFC 7591) into the connection's
 * `registered_client`, PKCE, and the pre-registered `clientId` form.
 *
 * End to end over a real ObjectQL on SQLite (the `Field.secret` seam is the
 * engine's) and one local HTTP server playing the MCP server's metadata, the
 * authorization server and its registration endpoint. The `mcp` provider here
 * is a stand-in registered as asking the credential handle; the real one is
 * `@objectstack/connector-mcp`'s. The values below are obvious dummies.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { callWithBorrowedCredential } from '@objectstack/types';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import {
    ConnectorCredentialRejectedError,
    type Connector,
    type ConnectorProviderContext,
    type ConnectorProviderFactory,
} from '@objectstack/spec/integration';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { SysConnectorCredential } from './sys-connector-credential.object.js';
import { SysConnectorConnection } from './sys-connector-connection.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import { CONNECTOR_CONNECTION_OBJECT } from './connector-connections.js';

const GOOD_CODE = 'dummy-code-mcp-26702';
const REGISTERED_SECRET = 'dummy-registered-secret-26702';
const DECLARED_SECRET = 'dummy-declared-secret-26702';
const REDIRECT_URI = 'https://app.example.com/api/v1/automation/connectors/oauth/callback';
const SYSTEM = { isSystem: true } as const;
const ADMIN_A = { userId: 'usr_admin', tenantId: 'org_a' };
const ADMIN_B = { userId: 'usr_admin', tenantId: 'org_b' };
const ADMIN_C = { userId: 'usr_admin', tenantId: 'org_c' };

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** What the local server answers, per test. */
const mcp = {
    server: undefined as Server | undefined,
    base: '',
    /** Every request the server saw: method, path, Authorization and body. */
    seen: [] as Array<{ method: string; path: string; authorization?: string; body: string }>,
    s256: true,
    registration: true,
    /** Issue a client secret with the registration (a confidential client). */
    issueSecret: false,
    issuer: undefined as string | undefined,
    resource: undefined as string | undefined,
    registered: 0,
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
    mcp.server = createServer(async (req, res) => {
        const body = await readBody(req);
        const path = (req.url ?? '').split('?')[0];
        mcp.seen.push({ method: req.method ?? '', path, ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), body });
        const answer = (status: number, json: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(json));
        };
        if (path === '/.well-known/oauth-protected-resource/mcp') {
            return answer(200, { resource: mcp.resource ?? `${mcp.base}/mcp`, authorization_servers: [`${mcp.base}/auth`] });
        }
        if (path === '/.well-known/oauth-authorization-server/auth') {
            return answer(200, {
                issuer: mcp.issuer ?? `${mcp.base}/auth`,
                authorization_endpoint: `${mcp.base}/auth/authorize`,
                token_endpoint: `${mcp.base}/auth/token`,
                ...(mcp.registration ? { registration_endpoint: `${mcp.base}/auth/register` } : {}),
                code_challenge_methods_supported: mcp.s256 ? ['S256'] : ['plain'],
            });
        }
        if (path === '/auth/register' && req.method === 'POST') {
            mcp.registered += 1;
            return answer(201, {
                client_id: `dcr-client-${mcp.registered}`,
                ...(mcp.issueSecret ? { client_secret: REGISTERED_SECRET } : {}),
            });
        }
        if (path === '/auth/token' && req.method === 'POST') {
            const form = Object.fromEntries(new URLSearchParams(body));
            mcp.issued += 1;
            const n = mcp.issued;
            if (form.grant_type === 'authorization_code' && form.code !== GOOD_CODE) return answer(400, { error: 'invalid_grant' });
            return answer(200, { access_token: `dummy-at-${n}`, token_type: 'Bearer', expires_in: 3600, refresh_token: `dummy-rt-${n}` });
        }
        return answer(404, {});
    });
    await new Promise<void>((r) => mcp.server!.listen(0, '127.0.0.1', () => r()));
    mcp.base = `http://127.0.0.1:${(mcp.server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((r) => mcp.server!.close(() => r()));
});

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

/** A declared `provider: 'mcp'` instance over http with only the grant: everything else is discovered. */
function notion(auth: Record<string, unknown> = {}, transportUrl?: string) {
    return {
        name: 'notion',
        label: 'Notion',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'http', url: transportUrl ?? `${mcp.base}/mcp` } },
        auth: { type: 'oauth2', grant: 'authorization_code', ...auth },
        _packageId: 'com.example.notion',
    };
}

/**
 * The `mcp` stand-in: asks the handle on every request, records the token it
 * was handed. With `lists`, it reads the upstream while it materializes, as
 * the real provider's `tools/list` does: an ask that names no organization.
 */
function mcpStandIn(lists = false) {
    const state = {
        materialized: [] as ConnectorProviderContext[],
        sent: [] as string[],
        listedWith: [] as string[],
        refuse: new Set<string>(),
        /** What the next listings answer, in order (then `200`): a `403` is thrown as the real provider throws it. */
        listingAnswers: [] as number[],
        /** Run before a listing answers (e.g. another replica's reconnect landing meanwhile). */
        beforeListingAnswer: undefined as undefined | (() => Promise<void>),
    };
    const factory: ConnectorProviderFactory = async (ctx) => {
        state.materialized.push(ctx);
        if (lists) {
            const listed = await callWithBorrowedCredential(ctx.credentialHandle!, async (auth) => {
                const token = auth.type === 'bearer' ? auth.token : '';
                state.listedWith.push(token);
                await state.beforeListingAnswer?.();
                return { status: state.listingAnswers.shift() ?? 200 };
            }, {});
            if (listed.status === 403) {
                throw new ConnectorCredentialRejectedError(`connector-mcp provider: connector '${ctx.name}' was refused by its MCP server (HTTP 403)`, 403);
            }
        }
        return {
            def: {
                name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' },
                actions: [{ key: 'search', label: 'Search' }],
            } as unknown as Connector,
            handlers: {
                search: async (_input, actionCtx) => callWithBorrowedCredential(
                    ctx.credentialHandle!,
                    async (auth) => {
                        const token = auth.type === 'bearer' ? auth.token : '';
                        state.sent.push(token);
                        return state.refuse.has(token) ? { status: 401, ok: false } : { status: 200, ok: true };
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
    Object.assign(mcp, { seen: [], s256: true, registration: true, issueSecret: false, issuer: undefined, resource: undefined, registered: 0, issued: 0 });
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

async function boot(declared: unknown[] = [notion()], opts: { lists?: boolean } = {}) {
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

    const provider = mcpStandIn(opts.lists);
    const kernel = new LiteKernel({ logger: { level: 'debug', format: 'json' } } as never);
    kernels.push(kernel);
    kernel.use(new AutomationServicePlugin({
        suspendedRunStore: 'memory',
        credentialResolver: (ref) => (ref === 'HUBSPOT_CLIENT_SECRET' ? DECLARED_SECRET : undefined),
        connectorOAuthRedirectUri: REDIRECT_URI,
    }));
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            ctx.registerService('data', ql);
            ctx.getService('automation').registerConnectorProvider('mcp', provider.factory, { credentialHandle: true });
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    const call = () => engine.resolveConnectorAction('notion', 'search')!({}, { automation: { tenantId: 'org_a' } } as never);
    const connect = async (
        query: (state: string) => Record<string, string> = (state) => ({ code: GOOD_CODE, state }),
        as: { userId: string; tenantId: string } = ADMIN_A,
    ) => {
        const begun = await engine.beginConnectorConnection({ connector: 'notion', context: as as never });
        const state = new URL(begun.authorizationUrl).searchParams.get('state')!;
        return { begun, done: () => engine.completeConnectorConnection({ query: query(state), context: as as never }) };
    };
    return { ql, engine, provider, call, connect };
}

const rowsOf = async (ql: ObjectQL) => (await ql.find(CONNECTOR_CONNECTION_OBJECT, { context: SYSTEM } as never)) as any[];
const requestsTo = (path: string) => mcp.seen.filter((r) => r.path === path);

describe('ADR-0143 D2.1 — the MCP authorization flow, with dynamic client registration', () => {
    it('discovers, registers a public client, connects, dispatches, and refreshes with the kept client', async () => {
        const { engine, provider, call, connect, ql } = await boot();
        // No endpoints and no client declared: held "not connected", not "not served".
        expect(engine.getConnectorDegradedReason('notion')).toContain("connector instance 'notion' is not connected");

        const { begun, done } = await connect();
        const url = new URL(begun.authorizationUrl);
        expect(url.origin + url.pathname).toBe(`${mcp.base}/auth/authorize`);
        expect(url.searchParams.get('client_id')).toBe('dcr-client-1');
        expect(url.searchParams.get('resource')).toBe(`${mcp.base}/mcp`);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);

        // The registration: one public client for the deployment's redirect URI.
        const [registration] = requestsTo('/auth/register');
        expect(JSON.parse(registration.body)).toMatchObject({
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        });
        // Beginning writes nothing to the connection record.
        expect(await rowsOf(ql)).toHaveLength(0);

        expect(await done()).toMatchObject({ connector: 'notion', organizationId: 'org_a', status: 'connected' });
        const [exchange] = requestsTo('/auth/token');
        const form = Object.fromEntries(new URLSearchParams(exchange.body));
        expect(form).toMatchObject({ grant_type: 'authorization_code', code: GOOD_CODE, client_id: 'dcr-client-1', resource: `${mcp.base}/mcp` });
        expect(exchange.authorization).toBeUndefined();
        expect(createHash('sha256').update(form.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));

        // The connection keeps the client, encrypted and masked.
        const [row] = await rowsOf(ql);
        expect(row.registered_client).not.toContain('dcr-client-1');
        const kept = JSON.parse(await (ql as any).resolveSecretField(CONNECTOR_CONNECTION_OBJECT, row.id, 'registered_client'));
        expect(kept).toMatchObject({ clientId: 'dcr-client-1', tokenUrl: `${mcp.base}/auth/token`, issuer: `${mcp.base}/auth`, registered: true });

        // Served through the handle; a 401 refreshes at the kept token endpoint as the kept client.
        expect(engine.getConnectorDegradedReason('notion')).toBeUndefined();
        expect(provider.state.materialized[0].auth).toBeUndefined();
        provider.state.refuse.add('dummy-at-1');
        expect(await call()).toMatchObject({ status: 200 });
        expect(provider.state.sent).toEqual(['dummy-at-1', 'dummy-at-2']);
        const refresh = Object.fromEntries(new URLSearchParams(requestsTo('/auth/token')[1].body));
        expect(refresh).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'dummy-rt-1', client_id: 'dcr-client-1', resource: `${mcp.base}/mcp` });
    });

    it('a reconnect reuses the client the connection keeps; nothing is registered twice', async () => {
        const { connect } = await boot();
        await (await connect()).done();
        const { begun } = await connect();
        expect(new URL(begun.authorizationUrl).searchParams.get('client_id')).toBe('dcr-client-1');
        expect(mcp.registered).toBe(1);
    });

    it('a registration that issues a client secret: the exchange authenticates with it, and it is never surfaced', async () => {
        const out = captureOutput();
        mcp.issueSecret = true;
        const { connect, ql, engine } = await boot();
        const { begun, done } = await connect();
        const answers = [JSON.stringify(begun), JSON.stringify(await done())];
        const [exchange] = requestsTo('/auth/token');
        expect(exchange.authorization).toBe(`Basic ${Buffer.from(`dcr-client-1:${REGISTERED_SECRET}`).toString('base64')}`);
        const surfaces = {
            logs: out.text(),
            answers: answers.join('\n'),
            descriptors: JSON.stringify(engine.getConnectorDescriptors()),
            'engine read': JSON.stringify(await rowsOf(ql)),
        };
        for (const [where, text] of Object.entries(surfaces)) {
            for (const secret of [REGISTERED_SECRET, GOOD_CODE, 'dummy-rt-1', 'dummy-at-1']) {
                expect(text.includes(secret), `${where} carries ${secret}`).toBe(false);
            }
        }
        expect(out.text()).toContain('the MCP authorization flow found its authorization server and registered a client');
    });
});

describe('ADR-0143 D4, ruled B — the connection an mcp instance lists its tools with', () => {
    /** The organizations that exchanged a code, in order: the n-th exchange is theirs. */
    const exchangedBy: string[] = [];
    /**
     * The organization an access token was issued to. The token endpoint
     * answers its n-th request with `dummy-at-<n>` and `dummy-rt-<n>`: an
     * exchange is the organization that connected, a refresh is the one whose
     * refresh token it spent.
     */
    const orgOfToken = (token: string): string | undefined => {
        const owners: string[] = [];
        let exchanges = 0;
        for (const r of requestsTo('/auth/token')) {
            const form = Object.fromEntries(new URLSearchParams(r.body));
            owners.push(form.grant_type === 'authorization_code'
                ? exchangedBy[exchanges++]
                : owners[Number(form.refresh_token.replace('dummy-rt-', '')) - 1]);
        }
        return owners[Number(token.replace('dummy-at-', '')) - 1];
    };
    const connectAs = async (connect: Awaited<ReturnType<typeof boot>>['connect'], as: { userId: string; tenantId: string }) => {
        const { done } = await connect(undefined, as);
        exchangedBy.push(as.tenantId);
        await done();
    };

    it('lists with the connection connected earliest; each dispatch still uses its own organization', async () => {
        exchangedBy.length = 0;
        const { engine, provider, connect } = await boot([notion()], { lists: true });
        await connectAs(connect, ADMIN_A);
        await connectAs(connect, ADMIN_B);
        await connectAs(connect, ADMIN_C);
        // Connecting org_b and org_c changed nothing about the listing: org_a stays the oldest connection.
        expect(provider.state.materialized).toHaveLength(1);
        expect(provider.state.listedWith.map(orgOfToken)).toEqual(['org_a']);

        // A dispatch asks in its own run's organization.
        const dispatch = (tenantId?: string) =>
            engine.resolveConnectorAction('notion', 'search')!({}, (tenantId ? { automation: { tenantId } } : {}) as never);
        await dispatch('org_b');
        expect(orgOfToken(provider.state.sent[provider.state.sent.length - 1])).toBe('org_b');
        // A run with no organization is still answered as D4 answers it: several connections, refused.
        await expect(dispatch()).rejects.toMatchObject({ status: 422 });

        // The listing organization revokes: the instance materializes again and lists with the next oldest,
        // while two organizations stay connected — a request naming none would be refused there.
        await engine.revokeConnectorConnection({ connector: 'notion', context: ADMIN_A as never });
        expect(engine.getConnectorDegradedReason('notion')).toBeUndefined();
        expect(provider.state.materialized).toHaveLength(2);
        expect(orgOfToken(provider.state.listedWith[provider.state.listedWith.length - 1])).toBe('org_b');
        await expect(dispatch()).rejects.toMatchObject({ status: 422 });
    });
});

describe('ADR-0143 D4 — a borrowed token refused at tool discovery is its connection\'s, not the client secret\'s', () => {
    const SECRET_REF = 'NOTION_CLIENT_SECRET';
    const STORED_SECRET = 'dummy-stored-secret-26702';
    const OPERATOR = { userId: 'usr_admin' } as never;
    const secretRow = async (engine: AutomationEngine) =>
        (await engine.listConnectorCredentialRefs()).find((r) => r.ref === SECRET_REF);
    const connectionOf = (engine: AutomationEngine, as: { userId: string; tenantId: string }) =>
        engine.getConnectorConnection({ connector: 'notion', context: as as never });

    it('the discovery organization\'s connection needs reconnecting; a reconnect there lists again', async () => {
        const { engine, provider, connect, call } = await boot([notion()], { lists: true });
        provider.state.listingAnswers.push(403);
        await (await connect()).done();
        expect(provider.state.listedWith).toHaveLength(1);

        // The connection whose token was refused is the one marked, with the platform's sentence.
        await vi.waitFor(async () => expect(await connectionOf(engine, ADMIN_A)).toMatchObject({
            status: 'reconnect_required',
            statusReason: expect.stringContaining('refused the token of this connection while it listed its tools (HTTP 403)'),
        }));
        await vi.waitFor(() => expect(engine.getConnectorDegradedReason('notion')).toContain("needs to be reconnected for organization 'org_a'"));
        expect(engine.getConnectorDegradedReason('notion')).toContain('while it listed its tools (HTTP 403)');
        expect(engine.resolveConnectorAction('notion', 'search')).toBeUndefined();

        // A reconnect by the same organization re-attempts discovery, and the instance serves.
        await (await connect()).done();
        await vi.waitFor(() => expect(engine.getConnectorDegradedReason('notion')).toBeUndefined());
        expect(provider.state.listedWith).toHaveLength(2);
        expect(await connectionOf(engine, ADMIN_A)).toMatchObject({ status: 'connected' });
        expect(await call()).toMatchObject({ status: 200 });
    });

    it('the stored client secret stays `set`; the instance lists as the next organization, each dispatch keeps its own', async () => {
        const { engine, provider, connect } = await boot([notion({ clientId: 'notion-app', credentialRef: SECRET_REF })], { lists: true });
        await engine.setConnectorCredential({ ref: SECRET_REF, value: STORED_SECRET, context: OPERATOR });
        await (await connect(undefined, ADMIN_A)).done();
        await (await connect(undefined, ADMIN_B)).done();
        expect(provider.state.materialized).toHaveLength(1);

        // The secret is set again: the instance materializes again, listing as org_a (the earliest), which is refused.
        provider.state.listingAnswers.push(403);
        await engine.setConnectorCredential({ ref: SECRET_REF, value: `${STORED_SECRET}-2`, context: OPERATOR });
        await vi.waitFor(() => expect(provider.state.materialized).toHaveLength(3));
        await vi.waitFor(() => expect(engine.getConnectorDegradedReason('notion')).toBeUndefined());

        expect(await secretRow(engine)).toMatchObject({ status: 'set' });
        expect(await connectionOf(engine, ADMIN_A)).toMatchObject({ status: 'reconnect_required' });
        expect(await connectionOf(engine, ADMIN_B)).toMatchObject({ status: 'connected' });
        const dispatch = (tenantId: string) =>
            engine.resolveConnectorAction('notion', 'search')!({}, { automation: { tenantId } } as never);
        expect(await dispatch('org_b')).toMatchObject({ status: 200 });
        await expect(dispatch('org_a')).rejects.toMatchObject({ status: 503, message: expect.stringContaining("needs to be reconnected for organization 'org_a'") });
    });

    it('a reconnect that landed while the refused token was listing keeps its fresh grant; the instance retries', async () => {
        const { engine, provider, connect, ql } = await boot([notion()], { lists: true });
        provider.state.listingAnswers.push(403);
        // Another replica's reconnect: the row is a new connect by the time the refusal is recorded.
        provider.state.beforeListingAnswer = async () => {
            provider.state.beforeListingAnswer = undefined;
            const [row] = await rowsOf(ql);
            await ql.update(CONNECTOR_CONNECTION_OBJECT, { id: row.id, connected_at: '2999-01-01T00:00:00.000Z' }, { context: SYSTEM } as never);
        };
        await (await connect()).done();
        expect(provider.state.listedWith).toHaveLength(1);
        expect(await connectionOf(engine, ADMIN_A)).toMatchObject({ status: 'connected' });
        expect(engine.getConnectorDegradedReason('notion')).toContain("refused the token of organization 'org_a' while it listed its tools (HTTP 403); it retries");
    });

    it('CONTROL: a client_credentials token the instance mints itself keeps the client secret\'s attribution', async () => {
        const { engine, provider } = await boot([notion({
            grant: 'client_credentials', clientId: 'notion-app', tokenUrl: `${mcp.base}/auth/token`, credentialRef: SECRET_REF,
        })], { lists: true });
        provider.state.listingAnswers.push(403);
        await engine.setConnectorCredential({ ref: SECRET_REF, value: STORED_SECRET, context: OPERATOR });
        await vi.waitFor(() => expect(provider.state.listedWith).toHaveLength(1));
        await vi.waitFor(async () => expect(await secretRow(engine)).toMatchObject({ status: 'rejected' }));
        expect(engine.getConnectorDegradedReason('notion')).toContain('HTTP 403');
    });
});

describe('ADR-0143 D2.1 — the pre-registered clientId form', () => {
    it('a declared clientId is used as is: no registration, the exchange authenticates with the declared secret', async () => {
        const { connect, ql } = await boot([notion({ clientId: 'hubspot-app', credentialRef: 'HUBSPOT_CLIENT_SECRET' })]);
        const { begun, done } = await connect();
        expect(new URL(begun.authorizationUrl).searchParams.get('client_id')).toBe('hubspot-app');
        await done();
        expect(mcp.registered).toBe(0);
        expect(requestsTo('/auth/token')[0].authorization).toBe(`Basic ${Buffer.from(`hubspot-app:${DECLARED_SECRET}`).toString('base64')}`);
        // The kept client carries the discovered endpoints, never the declared secret.
        const [row] = await rowsOf(ql);
        const kept = await (ql as any).resolveSecretField(CONNECTOR_CONNECTION_OBJECT, row.id, 'registered_client');
        expect(JSON.parse(kept)).toMatchObject({ clientId: 'hubspot-app', registered: false });
        expect(kept).not.toContain(DECLARED_SECRET);
    });
});

describe('ADR-0143 D2.1 — what the flow refuses', () => {
    it('⛔ a callback naming another issuer is refused before its code is used (RFC 9207)', async () => {
        const { connect, ql } = await boot();
        const { done } = await connect((state) => ({ code: GOOD_CODE, state, iss: 'https://evil.example.com' }));
        await expect(done()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('names an issuer other than') });
        expect(requestsTo('/auth/token')).toHaveLength(0);
        expect(await rowsOf(ql)).toHaveLength(0);
    });

    it('a callback naming the discovered issuer is accepted', async () => {
        const { connect } = await boot();
        const { done } = await connect((state) => ({ code: GOOD_CODE, state, iss: `${mcp.base}/auth` }));
        await expect(done()).resolves.toMatchObject({ status: 'connected' });
    });

    it('⛔ an authorization server that does not list S256 is refused at begin; nothing is registered', async () => {
        mcp.s256 = false;
        const { engine } = await boot();
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('S256') });
        expect(mcp.registered).toBe(0);
    });

    it('⛔ metadata whose issuer is not the one asked for is refused (RFC 8414 §3.3)', async () => {
        mcp.issuer = 'https://other.example.com';
        const { engine } = await boot();
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('`issuer` other than') });
        expect(mcp.registered).toBe(0);
    });

    it('⛔ protected-resource metadata naming another server is refused', async () => {
        mcp.resource = 'https://elsewhere.example.com/mcp';
        const { engine } = await boot();
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('`resource` other than') });
    });

    it('no registration endpoint and no declared clientId: refused at begin, naming the pre-registered form', async () => {
        mcp.registration = false;
        const { engine } = await boot();
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400, message: expect.stringContaining('declare a pre-registered `clientId`') });
    });

    it('an MCP server that does not answer is a 503 at begin', async () => {
        const { engine } = await boot([notion({}, 'http://127.0.0.1:9/mcp')]);
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    });

    it('⛔ an MCP server whose url is not https off loopback is not served, and the door refuses it', async () => {
        const { engine } = await boot([notion({}, 'http://mcp.example.com/mcp')]);
        expect(engine.getConnectorDegradedReason('notion')).toContain('transport `url` is not over https');
        await expect(engine.beginConnectorConnection({ connector: 'notion', context: ADMIN_A as never }))
            .rejects.toMatchObject({ status: 400 });
        expect(mcp.seen).toHaveLength(0);
    });

    it('CONTROL: a client_credentials instance on mcp without its endpoints is still not served', async () => {
        const { engine } = await boot([notion({ grant: 'client_credentials', credentialRef: 'HUBSPOT_CLIENT_SECRET' })]);
        expect(engine.getConnectorDegradedReason('notion')).toContain('without `tokenUrl`, `clientId`');
    });
});
