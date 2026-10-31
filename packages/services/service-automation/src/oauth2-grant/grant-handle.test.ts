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
import { createOAuth2GrantHandle, type OAuth2GrantConfig } from './grant-handle.js';

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
function fakeConnections(rows: Array<{ org: string; refreshToken?: string; status?: ConnectorConnectionRecord['status'] }>) {
    const held = new Map<string, ConnectorConnectionRecord & { refreshToken?: string }>();
    for (const r of rows) {
        held.set(r.org, {
            id: `row_${r.org}`,
            organizationId: r.org,
            connectorName: 'crm',
            status: r.status ?? 'connected',
            revision: 1,
            hasRefreshToken: r.refreshToken !== undefined,
            refreshToken: r.refreshToken,
        });
    }
    const strip = (r: ConnectorConnectionRecord & { refreshToken?: string }): ConnectorConnectionRecord => {
        const { refreshToken: _omit, ...rest } = r;
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
        const refused = await callWithBorrowedCredential(handle, upstream as never).catch((e) => e);
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
        expect(onGrantRefused).toHaveBeenCalledWith('org_a');
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
