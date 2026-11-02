// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 — the per-dispatch credential of an `oauth2` instance: which
// connection a request uses, when a token is refreshed (skew margin, once on a
// 401), single flight, the cluster lock, and how a refused grant reads. The
// connection store is a double here; `connector-connection-door.test.ts` runs
// the same handle over a real engine. The values below are obvious dummies.

import { describe, expect, it, vi } from 'vitest';
import { callWithBorrowedCredential, BORROWED_CREDENTIAL_SKEW_MS } from '@objectstack/types';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import type { ILock } from '@objectstack/spec/contracts';
import type { ConnectorConnectionRecord, ConnectorConnectionStore, ConnectorGrantWrite } from '../connector-connections.js';
import { createOAuth2GrantHandle, reconnectRequiredReason, type OAuth2GrantConfig } from './grant-handle.js';
import { serializeInstallerClient } from './installer-client.js';

const TOKEN_URL = 'https://idp.example.com/oauth/token';

/** The token endpoint double: records each request's form, answers from `next`. */
function tokenEndpoint() {
    const requests: URLSearchParams[] = [];
    let n = 0;
    const state = {
        requests,
        /** What the next answer is; default a fresh bearer token valid for an hour, with a rotated refresh token. */
        answer: (): { status: number; body: unknown } => ({
            status: 200,
            body: { access_token: `dummy-at-${n}`, token_type: 'Bearer', expires_in: 3600, refresh_token: `dummy-rt-${n}` },
        }),
        /** Resolve answers only when released, to hold requests in flight. */
        gate: undefined as Promise<void> | undefined,
    };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
        requests.push(new URLSearchParams(String(init.body)));
        n += 1;
        if (state.gate) await state.gate;
        const { status, body } = state.answer();
        return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { state, fetch: fetchImpl };
}

/** An in-memory connection store with the semantics of `ConnectorConnectionStore`. */
function fakeConnections(rows: Array<{ org: string; refreshToken?: string; status?: ConnectorConnectionRecord['status']; registeredClient?: string }>) {
    const held = new Map<string, ConnectorConnectionRecord & { refreshToken?: string; registeredClient?: string }>();
    for (const r of rows) {
        held.set(r.org, {
            id: `row_${r.org}`,
            organizationId: r.org,
            connectorName: 'crm',
            status: r.status ?? 'connected',
            revision: 1,
            hasRefreshToken: r.refreshToken !== undefined,
            hasRegisteredClient: r.registeredClient !== undefined,
            installerClientHasSecret: false,
            refreshToken: r.refreshToken,
            registeredClient: r.registeredClient,
        });
    }
    const strip = (r: ConnectorConnectionRecord & { refreshToken?: string; registeredClient?: string }): ConnectorConnectionRecord => {
        const { refreshToken: _omit, registeredClient: _omitClient, ...rest } = r;
        return { ...rest };
    };
    const calls = { read: 0, markReconnectRequired: [] as string[], recordRefresh: [] as ConnectorGrantWrite[] };
    const store = {
        async read(org: string) {
            calls.read += 1;
            const r = held.get(org);
            return r ? strip(r) : undefined;
        },
        async listFor() {
            return [...held.values()].map(strip);
        },
        async resolveRefreshToken(record: ConnectorConnectionRecord) {
            return held.get(record.organizationId)?.refreshToken;
        },
        async resolveRegisteredClient(record: ConnectorConnectionRecord) {
            return held.get(record.organizationId)?.registeredClient;
        },
        async recordRefresh(record: ConnectorConnectionRecord, write: ConnectorGrantWrite) {
            const r = held.get(record.organizationId);
            if (!r || r.revision !== record.revision) return false;
            calls.recordRefresh.push(write);
            if (write.refreshToken !== undefined) {
                r.refreshToken = write.refreshToken;
                r.revision += 1;
            }
            return true;
        },
        async markReconnectRequired(record: ConnectorConnectionRecord, reason: string) {
            const r = held.get(record.organizationId);
            if (!r || r.revision !== record.revision) return;
            calls.markReconnectRequired.push(record.organizationId);
            r.status = 'reconnect_required';
            r.statusReason = reason;
            r.refreshToken = undefined;
            r.hasRefreshToken = false;
        },
    };
    return { store: store as unknown as ConnectorConnectionStore, held, calls };
}

const AUTH_CODE: OAuth2GrantConfig = { grant: 'authorization_code', tokenUrl: TOKEN_URL, clientId: 'client-1', clientSecret: 'dummy-client-secret' };
const CLIENT_CREDENTIALS: OAuth2GrantConfig = { ...AUTH_CODE, grant: 'client_credentials', scopes: ['read'], resource: 'https://api.example.com' };

describe('ADR-0143 D4 — client_credentials', () => {
    it('exchanges the client secret once, serves the cached token, and re-derives it inside the skew margin', async () => {
        const idp = tokenEndpoint();
        let clock = 0;
        const handle = createOAuth2GrantHandle({
            connector: 'crm', config: CLIENT_CREDENTIALS, connections: fakeConnections([]).store, fetch: idp.fetch, now: () => clock,
        });
        const first = await handle.get();
        expect(first.auth).toEqual({ type: 'bearer', token: 'dummy-at-1' });
        expect(first.expiresAt).toBe(3_600_000);
        expect(Object.fromEntries(idp.state.requests[0])).toEqual({
            grant_type: 'client_credentials', scope: 'read', resource: 'https://api.example.com',
        });
        // An org on the request selects nothing: the token belongs to the instance.
        expect((await handle.get({ organizationId: 'org_b' })).auth).toEqual(first.auth);
        expect(idp.state.requests).toHaveLength(1);

        clock = 3_600_000 - BORROWED_CREDENTIAL_SKEW_MS + 1; // inside the margin
        expect((await handle.get()).auth).toEqual({ type: 'bearer', token: 'dummy-at-2' });
        expect(idp.state.requests).toHaveLength(2);
    });

    it('single flight: concurrent requests share one token request', async () => {
        const idp = tokenEndpoint();
        let release!: () => void;
        idp.state.gate = new Promise<void>((r) => { release = r; });
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: CLIENT_CREDENTIALS, connections: fakeConnections([]).store, fetch: idp.fetch });
        const all = Promise.all([handle.get(), handle.get(), handle.refresh(), handle.get()]);
        release();
        const got = await all;
        expect(idp.state.requests).toHaveLength(1);
        expect(new Set(got.map((g) => (g.auth as { token: string }).token))).toEqual(new Set(['dummy-at-1']));
    });

    it('a 401 refreshes once and retries once; a second 401 is the 503 refusal naming the instance', async () => {
        const idp = tokenEndpoint();
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: CLIENT_CREDENTIALS, connections: fakeConnections([]).store, fetch: idp.fetch });
        const sent: string[] = [];
        const accept = new Set(['dummy-at-2']);
        const upstream = async (auth: { type: string; token?: string }) => {
            sent.push(auth.token!);
            return { status: accept.has(auth.token!) ? 200 : 401 };
        };
        expect(await callWithBorrowedCredential(handle, upstream as never)).toEqual({ status: 200 });
        expect(sent).toEqual(['dummy-at-1', 'dummy-at-2']);

        accept.clear();
        const refused = (await callWithBorrowedCredential(handle, upstream as never).catch((e: Error) => e)) as Error;
        expect(refused).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(String(refused.message)).toContain("connector instance 'crm'");
        expect(String(refused.message)).not.toContain('dummy-at');
    });
});

describe('ADR-0143 D4 — authorization_code: which connection a request uses', () => {
    it("a request names its organization, and gets that organization's connection", async () => {
        const idp = tokenEndpoint();
        const { store } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }, { org: 'org_b', refreshToken: 'dummy-rt-b' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        await handle.get({ organizationId: 'org_b' });
        expect(Object.fromEntries(idp.state.requests[0])).toEqual({ grant_type: 'refresh_token', refresh_token: 'dummy-rt-b' });
    });

    it('a request with no organization uses the only connection, and is refused (422) when there are several', async () => {
        const idp = tokenEndpoint();
        const one = createOAuth2GrantHandle({
            connector: 'crm', config: AUTH_CODE, connections: fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]).store, fetch: idp.fetch,
        });
        await one.get();
        expect(idp.state.requests[0].get('refresh_token')).toBe('dummy-rt-a');

        const two = createOAuth2GrantHandle({
            connector: 'crm',
            config: AUTH_CODE,
            connections: fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }, { org: 'org_b', refreshToken: 'dummy-rt-b' }]).store,
            fetch: idp.fetch,
        });
        const refused = await two.get().catch((e) => e);
        expect(refused).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
        expect(refused.message).toContain('connected for 2 organizations');
        expect(idp.state.requests).toHaveLength(1); // nothing was spent on the refused one
    });

    it('not connected, or reconnect required → 503 naming the organization; no token request', async () => {
        const idp = tokenEndpoint();
        const handle = createOAuth2GrantHandle({
            connector: 'crm',
            config: AUTH_CODE,
            connections: fakeConnections([{ org: 'org_r', status: 'reconnect_required' }]).store,
            fetch: idp.fetch,
        });
        await expect(handle.get({ organizationId: 'org_none' })).rejects.toMatchObject({
            status: 503, message: expect.stringContaining("is not connected for organization 'org_none'"),
        });
        await expect(handle.get({ organizationId: 'org_r' })).rejects.toMatchObject({
            status: 503, message: expect.stringContaining("needs to be reconnected for organization 'org_r'"),
        });
        expect(idp.state.requests).toHaveLength(0);
    });
});

describe('ADR-0143 D4 — authorization_code: refresh', () => {
    it('a rotated refresh token is written over the revision it read, and the new token is cached under the new revision', async () => {
        const idp = tokenEndpoint();
        const { store, held, calls } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch, now: () => 0 });
        expect((await handle.get({ organizationId: 'org_a' })).auth).toEqual({ type: 'bearer', token: 'dummy-at-1' });
        expect(held.get('org_a')).toMatchObject({ refreshToken: 'dummy-rt-1', revision: 2 });
        expect(calls.recordRefresh[0]).toMatchObject({ refreshToken: 'dummy-rt-1', expiresAt: new Date(3_600_000) });
        // Served from the cache: the row's revision is the one cached.
        await handle.get({ organizationId: 'org_a' });
        expect(idp.state.requests).toHaveLength(1);
        // A 401's refresh spends the ROTATED token, not the first one.
        await handle.refresh({ organizationId: 'org_a' });
        expect(idp.state.requests[1].get('refresh_token')).toBe('dummy-rt-1');
    });

    it('a server that does not rotate keeps the stored refresh token and the revision', async () => {
        const idp = tokenEndpoint();
        idp.state.answer = () => ({ status: 200, body: { access_token: 'dummy-at-x', token_type: 'Bearer', expires_in: 60 } });
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        await handle.get({ organizationId: 'org_a' });
        expect(held.get('org_a')).toMatchObject({ refreshToken: 'dummy-rt-a', revision: 1 });
        await handle.get({ organizationId: 'org_a' });
        expect(idp.state.requests).toHaveLength(1);
    });

    it('single flight per organization: concurrent requests share one refresh, so a rotating grant is spent once', async () => {
        const idp = tokenEndpoint();
        let release!: () => void;
        idp.state.gate = new Promise<void>((r) => { release = r; });
        const { store } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }, { org: 'org_b', refreshToken: 'dummy-rt-b' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        const all = Promise.all([
            handle.get({ organizationId: 'org_a' }),
            handle.refresh({ organizationId: 'org_a' }),
            handle.get({ organizationId: 'org_a' }),
            handle.get({ organizationId: 'org_b' }),
        ]);
        await vi.waitFor(() => expect(idp.state.requests).toHaveLength(2));
        release();
        await all;
        expect(idp.state.requests.map((r) => r.get('refresh_token')).sort()).toEqual(['dummy-rt-a', 'dummy-rt-b']);
    });

    it('refreshes under the cluster lock and reads the row again inside it; a lock not obtained is UPSTREAM_UNAVAILABLE', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const keys: string[] = [];
        let obtain = true;
        const lock = {
            async withLock(key: string, fn: () => Promise<unknown>, opts: { ttlMs: number; waitMs: number }) {
                keys.push(key);
                expect(opts).toEqual({ ttlMs: 30_000, waitMs: 30_000 });
                if (!obtain) return null;
                // Another replica rotated the token while this one waited.
                held.get('org_a')!.refreshToken = 'dummy-rt-from-other-replica';
                return fn();
            },
        } as unknown as ILock;
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, lock: () => lock, fetch: idp.fetch });
        await handle.get({ organizationId: 'org_a' });
        expect(keys).toEqual(['connector-connection:crm:org_a:refresh']);
        expect(idp.state.requests[0].get('refresh_token')).toBe('dummy-rt-from-other-replica');

        obtain = false;
        await expect(handle.refresh({ organizationId: 'org_a' })).rejects.toBeInstanceOf(ConnectorUpstreamUnavailableError);
        expect(idp.state.requests).toHaveLength(1);
    });

    it('a row that moved while the request was out (a reconnect) caches nothing and is UPSTREAM_UNAVAILABLE', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const moving = (async (url: string, init: RequestInit) => {
            held.get('org_a')!.revision = 7;
            return idp.fetch(url as never, init);
        }) as unknown as typeof fetch;
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: moving });
        await expect(handle.get({ organizationId: 'org_a' })).rejects.toBeInstanceOf(ConnectorUpstreamUnavailableError);
        expect(held.get('org_a')).toMatchObject({ refreshToken: 'dummy-rt-a', revision: 7 });
    });

    it('an unreachable token endpoint is UPSTREAM_UNAVAILABLE and leaves the connection connected', async () => {
        const idp = tokenEndpoint();
        idp.state.answer = () => ({ status: 503, body: {} });
        const { store, held, calls } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const onGrantRefused = vi.fn();
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch, onGrantRefused });
        await expect(handle.get({ organizationId: 'org_a' })).rejects.toBeInstanceOf(ConnectorUpstreamUnavailableError);
        expect(held.get('org_a')?.status).toBe('connected');
        expect(calls.markReconnectRequired).toEqual([]);
        expect(onGrantRefused).not.toHaveBeenCalled();
    });

    it('`invalid_grant` marks the connection reconnect required, tells the plugin, and refuses the dispatch (503)', async () => {
        const idp = tokenEndpoint();
        idp.state.answer = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'dummy-rt-a was revoked' } });
        const { store, held, calls } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const onGrantRefused = vi.fn();
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch, onGrantRefused });
        const refused = await handle.get({ organizationId: 'org_a' }).catch((e) => e);
        expect(refused).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(refused.message).toContain('Reconnect required');
        expect(refused.message).not.toContain('dummy-rt-a');
        expect(calls.markReconnectRequired).toEqual(['org_a']);
        expect(held.get('org_a')).toMatchObject({ status: 'reconnect_required', refreshToken: undefined });
        expect(onGrantRefused).toHaveBeenCalledWith('org_a', refused.message);
        // The next dispatch reads the row: refused before any token request.
        await expect(handle.get({ organizationId: 'org_a' })).rejects.toMatchObject({ status: 503 });
        expect(idp.state.requests).toHaveLength(1);
    });

    it('a connection with no refresh token cannot be renewed: reconnect required, no token request', async () => {
        const idp = tokenEndpoint();
        const { store, calls } = fakeConnections([{ org: 'org_a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        await expect(handle.get({ organizationId: 'org_a' })).rejects.toMatchObject({
            status: 503, message: expect.stringContaining('issued no refresh token'),
        });
        expect(calls.markReconnectRequired).toEqual(['org_a']);
        expect(idp.state.requests).toHaveLength(0);
    });

    it('a seeded token (what the connect obtained) is served under its revision, and forgotten on revoke', async () => {
        const idp = tokenEndpoint();
        const { store } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch, now: () => 0 });
        handle.seed('org_a', 1, { accessToken: 'dummy-at-seeded', expiresAt: 3_600_000 });
        expect((await handle.get({ organizationId: 'org_a' })).auth).toEqual({ type: 'bearer', token: 'dummy-at-seeded' });
        expect(idp.state.requests).toHaveLength(0);
        // A seed under a stale revision is not served.
        handle.seed('org_a', 0, { accessToken: 'dummy-at-stale', expiresAt: 3_600_000 });
        expect((await handle.get({ organizationId: 'org_a' })).auth).toEqual({ type: 'bearer', token: 'dummy-at-1' });
        handle.forget('org_a');
        await handle.get({ organizationId: 'org_a' });
        expect(idp.state.requests).toHaveLength(2);
    });
});

describe('ADR-0143 D2.1 — an MCP instance whose connection keeps the client its authorization flow found', () => {
    const KEPT = (over: Record<string, unknown> = {}) => JSON.stringify({
        issuer: 'https://auth.mcp.example.com',
        authorizationUrl: 'https://auth.mcp.example.com/authorize',
        tokenUrl: 'https://auth.mcp.example.com/token',
        resource: 'https://mcp.example.com/mcp',
        clientId: 'registered-client-a',
        registered: true,
        ...over,
    });
    /** A token endpoint recording where each request went and how its client authenticated. */
    function recordingEndpoint() {
        const seen: Array<{ url: string; form: URLSearchParams; authorization?: string }> = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            const headers = new Headers(init.headers);
            seen.push({ url, form: new URLSearchParams(String(init.body)), ...(headers.get('authorization') ? { authorization: headers.get('authorization') as string } : {}) });
            return new Response(JSON.stringify({ access_token: `dummy-at-${seen.length}`, token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
        }) as unknown as typeof fetch;
        return { seen, fetch: fetchImpl };
    }
    const DISCOVERED: OAuth2GrantConfig = { grant: 'authorization_code' };

    it('refreshes at the kept token endpoint, as the kept public client, with the kept resource indicator', async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: KEPT() }]);
        const handle = createOAuth2GrantHandle({ connector: 'notion', config: DISCOVERED, connections: store, fetch: idp.fetch });
        expect((await handle.get({ organizationId: 'org_a' })).auth).toEqual({ type: 'bearer', token: 'dummy-at-1' });
        expect(idp.seen[0].url).toBe('https://auth.mcp.example.com/token');
        expect(idp.seen[0].form.get('client_id')).toBe('registered-client-a');
        expect(idp.seen[0].form.get('resource')).toBe('https://mcp.example.com/mcp');
        expect(idp.seen[0].authorization).toBeUndefined();
    });

    it('each organization refreshes with its own kept client', async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([
            { org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: KEPT() },
            { org: 'org_b', refreshToken: 'dummy-rt-b', registeredClient: KEPT({ clientId: 'registered-client-b', clientSecret: 'dummy-registered-secret' }) },
        ]);
        const handle = createOAuth2GrantHandle({ connector: 'notion', config: DISCOVERED, connections: store, fetch: idp.fetch });
        await handle.get({ organizationId: 'org_a' });
        await handle.get({ organizationId: 'org_b' });
        expect(idp.seen[0].form.get('client_id')).toBe('registered-client-a');
        expect(idp.seen[1].authorization).toMatch(/^Basic /);
        expect(idp.seen[1].form.get('client_id')).toBeNull();
    });

    it('a declared clientId and secret win over the kept client; the kept endpoints are still used', async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: KEPT({ clientId: 'hubspot-app', registered: false }) }]);
        const handle = createOAuth2GrantHandle({
            connector: 'hubspot',
            config: { grant: 'authorization_code', clientId: 'hubspot-app', clientSecret: 'dummy-declared-secret' },
            connections: store,
            fetch: idp.fetch,
        });
        await handle.get({ organizationId: 'org_a' });
        expect(idp.seen[0].url).toBe('https://auth.mcp.example.com/token');
        expect(idp.seen[0].authorization).toMatch(/^Basic /);
    });

    it('⛔ a connection that keeps no client it can be read back as is reconnect required; no token request', async () => {
        const idp = recordingEndpoint();
        const onGrantRefused = vi.fn();
        const { store, calls } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'notion', config: DISCOVERED, connections: store, fetch: idp.fetch, onGrantRefused });
        await expect(handle.get({ organizationId: 'org_a' })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(idp.seen).toHaveLength(0);
        expect(calls.markReconnectRequired).toEqual(['org_a']);
        expect(onGrantRefused).toHaveBeenCalledWith('org_a', expect.stringContaining('keeps no client to refresh with'));
    });
});

describe("ADR-0143 D2.1 (2026-11-02) — an instance taking the installer's client refreshes as the client its administrator entered", () => {
    const INSTALLER_SECRET = 'dummy-installer-secret-28866';
    const DISCOVERED_ENDPOINTS = {
        issuer: 'https://auth.mcp.example.com',
        authorizationUrl: 'https://auth.mcp.example.com/authorize',
        tokenUrl: 'https://auth.mcp.example.com/token',
        resource: 'https://mcp.example.com/mcp',
        clientId: 'installer-client-a',
        registered: false,
    };
    function recordingEndpoint() {
        const seen: Array<{ url: string; form: URLSearchParams; authorization?: string }> = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            const headers = new Headers(init.headers);
            seen.push({ url, form: new URLSearchParams(String(init.body)), ...(headers.get('authorization') ? { authorization: headers.get('authorization') as string } : {}) });
            return new Response(JSON.stringify({ access_token: `dummy-at-${seen.length}`, token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
        }) as unknown as typeof fetch;
        return { seen, fetch: fetchImpl };
    }
    const INSTALLER: OAuth2GrantConfig = { grant: 'authorization_code', tokenUrl: TOKEN_URL, clientSource: 'installer' };
    const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

    it("refreshes at the declared token endpoint as the connection's installer client, its secret in Basic", async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([{
            org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: serializeInstallerClient({ clientId: 'installer-client-a', clientSecret: INSTALLER_SECRET }),
        }]);
        const handle = createOAuth2GrantHandle({ connector: 'docusign', config: INSTALLER, connections: store, fetch: idp.fetch });
        expect((await handle.get({ organizationId: 'org_a' })).auth).toEqual({ type: 'bearer', token: 'dummy-at-1' });
        expect(idp.seen[0].url).toBe(TOKEN_URL);
        expect(idp.seen[0].authorization).toBe(basic('installer-client-a', INSTALLER_SECRET));
        expect(idp.seen[0].form.get('grant_type')).toBe('refresh_token');
    });

    it('each organization refreshes with its own administrator\'s client; a public one sends its id in the form', async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([
            { org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: serializeInstallerClient({ clientId: 'installer-client-a', clientSecret: INSTALLER_SECRET }) },
            { org: 'org_b', refreshToken: 'dummy-rt-b', registeredClient: serializeInstallerClient({ clientId: 'installer-client-b' }) },
        ]);
        const handle = createOAuth2GrantHandle({ connector: 'docusign', config: INSTALLER, connections: store, fetch: idp.fetch });
        await handle.get({ organizationId: 'org_a' });
        await handle.get({ organizationId: 'org_b' });
        expect(idp.seen[0].authorization).toBe(basic('installer-client-a', INSTALLER_SECRET));
        expect(idp.seen[1].authorization).toBeUndefined();
        expect(idp.seen[1].form.get('client_id')).toBe('installer-client-b');
    });

    it("on MCP over http, refreshes at the kept discovered endpoint as the installer's client", async () => {
        const idp = recordingEndpoint();
        const { store } = fakeConnections([{
            org: 'org_a', refreshToken: 'dummy-rt-a',
            registeredClient: serializeInstallerClient({ clientId: 'installer-client-a', clientSecret: INSTALLER_SECRET }, DISCOVERED_ENDPOINTS),
        }]);
        const handle = createOAuth2GrantHandle({
            connector: 'notion', config: { grant: 'authorization_code', clientSource: 'installer' }, connections: store, fetch: idp.fetch,
        });
        await handle.get({ organizationId: 'org_a' });
        expect(idp.seen[0].url).toBe('https://auth.mcp.example.com/token');
        expect(idp.seen[0].form.get('resource')).toBe('https://mcp.example.com/mcp');
        expect(idp.seen[0].authorization).toBe(basic('installer-client-a', INSTALLER_SECRET));
    });

    it('⛔ a kept client of the other kind than the declaration takes is never used: reconnect required, no token request', async () => {
        // An installer declaration over a client an MCP registration kept, and
        // a dynamic-registration declaration over an installer's client.
        const registered = JSON.stringify({ ...DISCOVERED_ENDPOINTS, clientId: 'registered-client-a', registered: true });
        const installerKept = serializeInstallerClient({ clientId: 'installer-client-a', clientSecret: INSTALLER_SECRET }, DISCOVERED_ENDPOINTS);
        for (const [config, kept] of [
            [{ grant: 'authorization_code', clientSource: 'installer' }, registered],
            [{ grant: 'authorization_code' }, installerKept],
        ] as Array<[OAuth2GrantConfig, string]>) {
            const idp = recordingEndpoint();
            const { store, calls } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a', registeredClient: kept }]);
            const handle = createOAuth2GrantHandle({ connector: 'notion', config, connections: store, fetch: idp.fetch });
            const err = await handle.get({ organizationId: 'org_a' }).catch((e: Error) => e);
            expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            expect((err as Error).message).toContain('keeps no client to refresh with');
            expect((err as Error).message).not.toContain(INSTALLER_SECRET);
            expect(idp.seen).toHaveLength(0);
            expect(calls.markReconnectRequired).toEqual(['org_a']);
        }
    });
});

describe('[#28863] the stored reason of a connection marked reconnect required names the cause that happened', () => {
    const storedReason = (held: Map<string, ConnectorConnectionRecord>) => String(held.get('org_a')?.statusReason);

    it('no refresh token: the reason names the missing refresh token, claims no refusal and no expiry', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        const refused = await handle.get({ organizationId: 'org_a' }).catch((e) => e);
        const reason = storedReason(held);
        expect(reason).toContain("connector instance 'crm' needs to be reconnected for organization 'org_a'");
        expect(reason).toContain('issued no refresh token, so an access token the connection has to renew cannot be renewed');
        expect(reason).not.toMatch(/refused/);
        expect(reason).not.toMatch(/expired/);
        expect(refused.message).toBe(reason);
        expect(idp.state.requests).toHaveLength(0);
    });

    it('no client: the reason names the missing client, claims no refusal and no expiry', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'notion', config: { grant: 'authorization_code' }, connections: store, fetch: idp.fetch });
        const refused = await handle.get({ organizationId: 'org_a' }).catch((e) => e);
        const reason = storedReason(held);
        expect(reason).toContain("connector instance 'notion' needs to be reconnected for organization 'org_a'");
        expect(reason).toContain('keeps no client to refresh with, so an access token it has to renew cannot be renewed');
        expect(reason).not.toMatch(/refused/);
        expect(reason).not.toMatch(/expired/);
        expect(refused.message).toBe(reason);
        expect(idp.state.requests).toHaveLength(0);
    });

    it('control: a refresh the authorization server refuses (`invalid_grant`) stores a reason naming the refusal', async () => {
        const idp = tokenEndpoint();
        idp.state.answer = () => ({ status: 400, body: { error: 'invalid_grant' } });
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        const refused = await handle.get({ organizationId: 'org_a' }).catch((e) => e);
        const reason = storedReason(held);
        expect(reason).toContain('its authorization server refused the grant (revoked, or expired with no usable refresh)');
        expect(reason).not.toContain('dummy-rt-a');
        expect(refused.message).toBe(reason);
        expect(idp.state.requests).toHaveLength(1);
    });
});

describe('[#28963] a connection already marked reconnect required answers the cause it stores, and the log names it', () => {
    const NO_REFRESH_TOKEN = 'issued no refresh token, so an access token the connection has to renew cannot be renewed';
    const NO_CLIENT = 'keeps no client to refresh with, so an access token it has to renew cannot be renewed';
    const REFUSED = 'its authorization server refused the grant (revoked, or expired with no usable refresh)';
    const refusalOf = (p: Promise<unknown>) => p.then(() => { throw new Error('the dispatch was not refused'); }, (e: Error & { status?: number; code?: string }) => e);

    it('a row marked because no refresh token was issued answers that sentence on the first dispatch and on every later one', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        const first = await refusalOf(handle.get({ organizationId: 'org_a' }));
        const stored = String(held.get('org_a')?.statusReason);
        expect(stored).toContain(NO_REFRESH_TOKEN);
        expect(first.message).toBe(stored);
        // Every later dispatch reads the marked row and answers what it stores, not the refusal sentence.
        for (const later of [
            () => handle.get({ organizationId: 'org_a' }),
            () => handle.get({ organizationId: 'org_a' }),
            () => handle.refresh({ organizationId: 'org_a' }),
        ]) {
            const refused = await refusalOf(later());
            expect(refused).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
            expect(refused.message).toBe(stored);
            expect(refused.message).not.toMatch(/refused/);
        }
        // So does a handle that never saw the marking (another replica, a restart).
        const other = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        expect((await refusalOf(other.get({ organizationId: 'org_a' }))).message).toBe(stored);
        expect(idp.state.requests).toHaveLength(0);
    });

    it('a row another replica marked while this one waited for the lock answers the cause that replica stored', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a', refreshToken: 'dummy-rt-a' }]);
        const markedThere = reconnectRequiredReason('crm', 'org_a', 'no_client');
        const lock = {
            async withLock(_key: string, fn: () => Promise<unknown>) {
                Object.assign(held.get('org_a')!, { status: 'reconnect_required', statusReason: markedThere, refreshToken: undefined });
                return fn();
            },
        } as unknown as ILock;
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, lock: () => lock, fetch: idp.fetch });
        const refused = await refusalOf(handle.get({ organizationId: 'org_a' }));
        expect(refused).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(refused.message).toBe(markedThere);
        expect(idp.state.requests).toHaveLength(0);
    });

    it('a marked row that stores no cause still answers the refusal sentence, on both reads', async () => {
        const idp = tokenEndpoint();
        const { store, held } = fakeConnections([{ org: 'org_a', status: 'reconnect_required' }]);
        const handle = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, fetch: idp.fetch });
        const atSelect = await refusalOf(handle.get({ organizationId: 'org_a' }));
        expect(atSelect.message).toBe(reconnectRequiredReason('crm', 'org_a'));
        expect(atSelect.message).toContain(REFUSED);

        held.get('org_a')!.status = 'connected';
        held.get('org_a')!.refreshToken = 'dummy-rt-a';
        const lock = {
            async withLock(_key: string, fn: () => Promise<unknown>) {
                held.get('org_a')!.status = 'reconnect_required';
                return fn();
            },
        } as unknown as ILock;
        const locked = createOAuth2GrantHandle({ connector: 'crm', config: AUTH_CODE, connections: store, lock: () => lock, fetch: idp.fetch });
        const underLock = await refusalOf(locked.get({ organizationId: 'org_a' }));
        expect(underLock.message).toBe(reconnectRequiredReason('crm', 'org_a'));
        expect(idp.state.requests).toHaveLength(0);
    });

    it('the plugin is told the cause of each refresh path, in the words it stored', async () => {
        const cases = [
            { cause: NO_REFRESH_TOKEN, config: AUTH_CODE, row: { org: 'org_a' }, answer: undefined },
            { cause: NO_CLIENT, config: { grant: 'authorization_code' } as OAuth2GrantConfig, row: { org: 'org_a', refreshToken: 'dummy-rt-a' }, answer: undefined },
            { cause: REFUSED, config: AUTH_CODE, row: { org: 'org_a', refreshToken: 'dummy-rt-a' }, answer: { status: 400, body: { error: 'invalid_grant' } } },
        ];
        for (const { cause, config, row, answer } of cases) {
            const idp = tokenEndpoint();
            if (answer) idp.state.answer = () => answer;
            const { store, held } = fakeConnections([row]);
            const onGrantRefused = vi.fn();
            const handle = createOAuth2GrantHandle({ connector: 'crm', config, connections: store, fetch: idp.fetch, onGrantRefused });
            await refusalOf(handle.get({ organizationId: 'org_a' }));
            const stored = String(held.get('org_a')?.statusReason);
            expect(stored).toContain(cause);
            expect(onGrantRefused).toHaveBeenCalledTimes(1);
            expect(onGrantRefused).toHaveBeenCalledWith('org_a', stored);
        }
    });
});
