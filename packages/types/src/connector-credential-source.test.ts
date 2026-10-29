// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `callWithBorrowedCredential` — ADR-0143 D4's per-dispatch rule as a driver
 * presents a borrowed credential (ADR-0015 D7): refresh on expiry, once on a
 * `401` and retry, then a `503` naming the instance.
 *
 * The grant-bearing kinds do not exist in the authoring contract yet, so the
 * `oauth2` cases run against a source double that mints expiring tokens —
 * the shape those kinds answer through this handle when they land.
 */

import { describe, it, expect } from 'vitest';
import {
    callWithBorrowedCredential,
    type BorrowedConnectorAuth,
    type BorrowedConnectorCredential,
    type ConnectorCredentialHandle,
    type ConnectorCredentialRequest,
} from './connector-credential-source.js';

/** An `oauth2`-shaped handle: each refresh mints the next token, valid for `ttlMs` from `now()`. */
function mintingHandle(opts: { now: () => number; ttlMs: number }) {
    let issued = 1;
    let current: BorrowedConnectorCredential = { auth: { type: 'bearer', token: 'tok-1' }, expiresAt: opts.now() + opts.ttlMs };
    const requests: Array<{ op: 'get' | 'refresh'; request?: ConnectorCredentialRequest }> = [];
    let inflight: Promise<BorrowedConnectorCredential> | undefined;
    const handle: ConnectorCredentialHandle & { refreshes: () => number } = {
        connector: 'sap_s4',
        async get(request) {
            requests.push({ op: 'get', request });
            return current;
        },
        refresh(request) {
            requests.push({ op: 'refresh', request });
            inflight ??= (async () => {
                issued += 1;
                current = { auth: { type: 'bearer', token: `tok-${issued}` }, expiresAt: opts.now() + opts.ttlMs };
                return current;
            })().finally(() => { inflight = undefined; });
            return inflight;
        },
        refreshes: () => issued - 1,
    };
    return { handle, requests };
}

/** A static handle: `get` and `refresh` both answer `auth`, with no lifetime. */
function staticHandle(auth: BorrowedConnectorAuth) {
    let refreshes = 0;
    const handle: ConnectorCredentialHandle = {
        connector: 'crm_api',
        get: async () => ({ auth }),
        refresh: async () => { refreshes += 1; return { auth }; },
    };
    return { handle, refreshes: () => refreshes };
}

const tokenOf = (auth: BorrowedConnectorAuth): string => (auth.type === 'bearer' ? auth.token : '');

describe('callWithBorrowedCredential', () => {
    it('sends a borrowed static credential as it is, with no refresh', async () => {
        const { handle, refreshes } = staticHandle({ type: 'api-key', key: 'k-123', headerName: 'X-API-Key' });
        const sent: BorrowedConnectorAuth[] = [];
        const result = await callWithBorrowedCredential(handle, async (auth) => { sent.push(auth); return { status: 200, body: 'ok' }; });
        expect(result).toEqual({ status: 200, body: 'ok' });
        expect(sent).toEqual([{ type: 'api-key', key: 'k-123', headerName: 'X-API-Key' }]);
        expect(refreshes()).toBe(0);
    });

    it('refreshes an oauth2 credential that expired before it is sent', async () => {
        let clock = 1_000_000;
        const now = () => clock;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        clock += 3_600_000; // tok-1 is now past its expiry
        const sent: string[] = [];
        await callWithBorrowedCredential(handle, async (auth) => { sent.push(tokenOf(auth)); return { status: 200 }; }, { now });
        expect(sent).toEqual(['tok-2']);
        expect(handle.refreshes()).toBe(1);
    });

    it('refreshes inside the skew margin, not only past expiry', async () => {
        let clock = 0;
        const now = () => clock;
        const { handle } = mintingHandle({ now, ttlMs: 60_000 });
        clock = 40_000; // 20 s left, inside the 30 s default margin
        const sent: string[] = [];
        await callWithBorrowedCredential(handle, async (auth) => { sent.push(tokenOf(auth)); return { status: 200 }; }, { now });
        expect(sent).toEqual(['tok-2']);
    });

    it('sends an unexpired oauth2 credential without refreshing it', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        const sent: string[] = [];
        await callWithBorrowedCredential(handle, async (auth) => { sent.push(tokenOf(auth)); return { status: 200 }; }, { now });
        expect(sent).toEqual(['tok-1']);
        expect(handle.refreshes()).toBe(0);
    });

    it('refreshes once on a 401 result and retries with the new credential', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        const sent: string[] = [];
        const result = await callWithBorrowedCredential(
            handle,
            async (auth) => { sent.push(tokenOf(auth)); return { status: tokenOf(auth) === 'tok-1' ? 401 : 200 }; },
            { now },
        );
        expect(result).toEqual({ status: 200 });
        expect(sent).toEqual(['tok-1', 'tok-2']);
        expect(handle.refreshes()).toBe(1);
    });

    it('reads a thrown error declaring 401 as the same refusal', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        const sent: string[] = [];
        const result = await callWithBorrowedCredential(handle, async (auth) => {
            sent.push(tokenOf(auth));
            if (tokenOf(auth) === 'tok-1') throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
            return 'rows';
        }, { now });
        expect(result).toBe('rows');
        expect(sent).toEqual(['tok-1', 'tok-2']);
    });

    it('ends on a 503 naming the instance when the refreshed credential is refused too, without the upstream text', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        let calls = 0;
        const run = callWithBorrowedCredential(handle, async (auth) => {
            calls += 1;
            throw Object.assign(new Error(`bad token ${tokenOf(auth)}`), { status: 401 });
        }, { now });
        await expect(run).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        const err = await run.catch((e: Error) => e);
        expect(err.message).toContain("connector instance 'sap_s4'");
        expect(err.message).not.toContain('tok-');
        expect(calls).toBe(2);
        expect(handle.refreshes()).toBe(1);
    });

    it('passes a non-401 result and a non-401 throw through unchanged', async () => {
        const { handle, refreshes } = staticHandle({ type: 'bearer', token: 't' });
        await expect(callWithBorrowedCredential(handle, async () => ({ status: 403 }))).resolves.toEqual({ status: 403 });
        const boom = Object.assign(new Error('gateway'), { status: 502 });
        await expect(callWithBorrowedCredential(handle, async () => { throw boom; })).rejects.toBe(boom);
        expect(refreshes()).toBe(0);
    });

    it('honours a caller-supplied isUnauthorized', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        const sent: string[] = [];
        await callWithBorrowedCredential(
            handle,
            async (auth) => { sent.push(tokenOf(auth)); return { ok: tokenOf(auth) !== 'tok-1' }; },
            { now, isUnauthorized: (r) => !r.ok },
        );
        expect(sent).toEqual(['tok-1', 'tok-2']);
    });

    it('asks the handle in the name of the request organization', async () => {
        const now = () => 0;
        const { handle, requests } = mintingHandle({ now, ttlMs: 3_600_000 });
        await callWithBorrowedCredential(handle, async (auth) => ({ status: tokenOf(auth) === 'tok-1' ? 401 : 200 }), { now, organizationId: 'org_a' });
        expect(requests).toEqual([
            { op: 'get', request: { organizationId: 'org_a' } },
            { op: 'refresh', request: { organizationId: 'org_a' } },
        ]);
    });

    it('lets concurrent refusals share one refresh on a single-flight handle', async () => {
        const now = () => 0;
        const { handle } = mintingHandle({ now, ttlMs: 3_600_000 });
        const call = async (auth: BorrowedConnectorAuth) => ({ status: tokenOf(auth) === 'tok-1' ? 401 : 200 });
        await Promise.all([
            callWithBorrowedCredential(handle, call, { now }),
            callWithBorrowedCredential(handle, call, { now }),
        ]);
        expect(handle.refreshes()).toBe(1);
    });

    it('propagates a refusal of the handle itself', async () => {
        const refusal = Object.assign(new Error("credential 'sap_token' is not set"), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const handle: ConnectorCredentialHandle = { connector: 'sap_s4', get: async () => { throw refusal; }, refresh: async () => { throw refusal; } };
        await expect(callWithBorrowedCredential(handle, async () => 'never')).rejects.toBe(refusal);
    });
});
