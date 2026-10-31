// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D5 — the begin half of the connect flow: PKCE (S256 always), the
// state, the authorization URL, and the single-use store a begun connect waits in.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IKV } from '@objectstack/spec/contracts';
import {
    PENDING_AUTHORIZATION_TTL_SECONDS,
    buildAuthorizationUrl,
    createAuthorizationState,
    createPkcePair,
    kvPendingAuthorizationStore,
    memoryPendingAuthorizationStore,
    openPendingAuthorization,
    sealPendingAuthorization,
    type PendingAuthorization,
} from './authorization.js';

const pending = (over: Partial<PendingAuthorization> = {}): PendingAuthorization => ({
    connector: 'crm',
    organizationId: 'org_a',
    userId: 'usr_1',
    verifier: 'dummy-verifier',
    redirectUri: 'https://app.example.com/api/v1/automation/connectors/oauth/callback',
    expiresAt: Date.now() + 60_000,
    ...over,
});

/** A minimal versioned KV, as the cluster service's is. */
function fakeKv() {
    const held = new Map<string, { value: unknown; version: number; ttl?: number }>();
    let version = 0;
    const kv = {
        async set(key: string, value: unknown, opts?: { ttl?: number }) {
            version += 1;
            held.set(key, { value, version, ttl: opts?.ttl });
        },
        async get(key: string) {
            const e = held.get(key);
            return e ? { value: e.value, version: e.version } : undefined;
        },
        async delete(key: string, opts?: { ifVersion?: number }) {
            const e = held.get(key);
            if (!e || (opts?.ifVersion !== undefined && opts.ifVersion !== e.version)) return false;
            held.delete(key);
            return true;
        },
    };
    return { kv: kv as unknown as IKV, held };
}

describe('ADR-0143 D5 — PKCE and state', () => {
    it('the challenge is the S256 of a 256-bit verifier (RFC 7636 §4.2)', () => {
        const { verifier, challenge } = createPkcePair();
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
        expect(createPkcePair().verifier).not.toBe(verifier);
    });

    it('a state is 256 bits and fresh each time', () => {
        const a = createAuthorizationState();
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(createAuthorizationState()).not.toBe(a);
    });

    it('the authorization URL asks for a code with the S256 challenge, the state and the fixed redirect URI', () => {
        const url = new URL(buildAuthorizationUrl({
            authorizationUrl: 'https://idp.example.com/authorize?tenant=x',
            clientId: 'client-1',
            redirectUri: 'https://app.example.com/cb',
            state: 'st',
            challenge: 'ch',
            scopes: ['read', 'write'],
            resource: 'https://api.example.com',
        }));
        expect(url.origin + url.pathname).toBe('https://idp.example.com/authorize');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            tenant: 'x',
            response_type: 'code',
            client_id: 'client-1',
            redirect_uri: 'https://app.example.com/cb',
            state: 'st',
            code_challenge: 'ch',
            code_challenge_method: 'S256',
            scope: 'read write',
            resource: 'https://api.example.com',
        });
    });
});

describe('ADR-0143 D5 — a begun connect is taken once', () => {
    it('in memory: a second take finds nothing', async () => {
        const store = memoryPendingAuthorizationStore();
        await store.put('st', pending());
        expect(await store.take('st')).toMatchObject({ connector: 'crm', userId: 'usr_1' });
        expect(await store.take('st')).toBeUndefined();
        expect(await store.take('never-begun')).toBeUndefined();
    });

    it('in the cluster KV: kept for the TTL under the state\'s digest, never under the raw state', async () => {
        const { kv, held } = fakeKv();
        const store = kvPendingAuthorizationStore(kv);
        await store.put('raw-state-value', pending());
        const [key, entry] = [...held][0];
        expect(key).not.toContain('raw-state-value');
        expect(key).toContain(createHash('sha256').update('raw-state-value').digest('hex'));
        expect(entry.ttl).toBe(PENDING_AUTHORIZATION_TTL_SECONDS);
        expect(await store.take('raw-state-value')).toMatchObject({ organizationId: 'org_a' });
        expect(await store.take('raw-state-value')).toBeUndefined();
    });

    it('in the cluster KV: of two callbacks racing on two replicas, only the one whose delete lands holds it', async () => {
        const { kv } = fakeKv();
        const store = kvPendingAuthorizationStore(kv);
        await store.put('st', pending());
        // The other replica read the same entry and deleted it first.
        const realDelete = kv.delete.bind(kv);
        (kv as any).delete = async (key: string, opts: Parameters<IKV['delete']>[1]) => {
            await realDelete(key);
            return realDelete(key, opts);
        };
        expect(await store.take('st')).toBeUndefined();
    });
});

describe('ADR-0143 D5 — a begun connect is held sealed (the KV trust boundary)', () => {
    const begun = pending({ verifier: 'dummy-verifier-7Qx', redirectUri: 'https://app.example.com/cb-sealed' });
    const keyOf = (state: string) => `connector-oauth2:pending:${createHash('sha256').update(state).digest('hex')}`;

    it('the KV holds no verifier, user, organization, instance or redirect URI — only an envelope', async () => {
        const { kv, held } = fakeKv();
        await kvPendingAuthorizationStore(kv).put('st-sealed', begun);
        const [, entry] = [...held][0];
        const stored = JSON.stringify(entry.value);
        for (const plain of [begun.verifier, begun.userId, begun.organizationId, begun.connector, begun.redirectUri, 'st-sealed']) {
            expect(stored).not.toContain(plain);
        }
        expect(Object.keys(entry.value as object).sort()).toEqual(['ct', 'iv', 'tag', 'v']);
    });

    it('an envelope edited in the KV opens as nothing, so its code is never exchanged', async () => {
        const { kv, held } = fakeKv();
        const store = kvPendingAuthorizationStore(kv);
        await store.put('st-edit', begun);
        const [key, entry] = [...held][0];
        const env = entry.value as { ct: string };
        const ct = Buffer.from(env.ct, 'base64url');
        ct[0] ^= 0x01;
        held.set(key, { ...entry, value: { ...env, ct: ct.toString('base64url') } });
        expect(await store.take('st-edit')).toBeUndefined();
    });

    it('an envelope moved to another state\'s slot opens as nothing there', async () => {
        const { kv, held } = fakeKv();
        const store = kvPendingAuthorizationStore(kv);
        await store.put('st-victim', begun);
        const [, entry] = [...held][0];
        await kv.set(keyOf('st-other'), entry.value);
        expect(await store.take('st-other')).toBeUndefined();
        // The slot the envelope was sealed for still opens.
        expect(await store.take('st-victim')).toMatchObject({ verifier: begun.verifier });
    });

    it('a plain value written into the KV is not read as a begun connect', async () => {
        const { kv } = fakeKv();
        await kv.set(keyOf('st-plain'), begun);
        expect(await kvPendingAuthorizationStore(kv).take('st-plain')).toBeUndefined();
    });

    it('the seal opens only under the state it was sealed with; the memory store holds the same envelope', async () => {
        const sealed = sealPendingAuthorization('st-a', begun);
        expect(openPendingAuthorization('st-a', sealed)).toEqual(begun);
        expect(openPendingAuthorization('st-b', sealed)).toBeUndefined();
        expect(openPendingAuthorization('st-a', { ...sealed, v: 2 })).toBeUndefined();
        const memory = memoryPendingAuthorizationStore();
        await memory.put('st-m', begun);
        expect(await memory.take('st-m')).toEqual(begun);
    });
});
