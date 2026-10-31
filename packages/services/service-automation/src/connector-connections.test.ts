// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D3 / D4 — the `sys_connector_connection` store over a real ObjectQL
// engine (SQLite, a test crypto provider): a refresh and the "reconnect
// required" mark are written only over the revision they read, by the write
// itself; a store that cannot be read refuses a connect and a revoke with the
// declared 503. The values below are obvious dummies.

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

import {
    CONNECTOR_CONNECTION_OBJECT,
    ConnectorConnectionStore,
    type ConnectorConnectionRecord,
} from './connector-connections.js';
import type { ConnectorCredentialEngine } from './connector-credentials.js';
import { SysConnectorConnection } from './sys-connector-connection.object.js';

const SYSTEM = { isSystem: true } as const;

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

const engines: ObjectQL[] = [];
afterEach(async () => {
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
});

async function dataEngine(): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    for (const object of [SysSecret, SysConnectorConnection]) (ql as any).registry.registerObject(object as never, 'test');
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    return ql;
}

/**
 * The engine as the store sees it, with `beforeUpdate` run between the store's
 * call and the real write — another replica's write landing in that gap.
 */
function interleaved(ql: ObjectQL, beforeUpdate: () => Promise<void>): ConnectorCredentialEngine {
    let armed = true;
    return {
        find: (o, q) => ql.find(o, q as never),
        insert: (o, d, opts) => ql.insert(o, d, opts as never),
        delete: (o, opts) => ql.delete(o, opts as never),
        resolveSecretField: (o, id, f) => (ql as any).resolveSecretField(o, id, f),
        async update(o, d, opts) {
            if (armed) {
                armed = false;
                await beforeUpdate();
            }
            return ql.update(o, d, opts as never);
        },
    };
}

async function connected(ql: ObjectQL): Promise<{ store: ConnectorConnectionStore; record: ConnectorConnectionRecord }> {
    const store = new ConnectorConnectionStore(() => ql as unknown as ConnectorCredentialEngine);
    const record = await store.connect({ organizationId: 'org_a', connectorName: 'crm', userId: 'usr_admin', refreshToken: 'dummy-rt-1' });
    return { store, record };
}

/** Another replica's reconnect: a fresh grant over the same row, revision raised. */
async function reconnectElsewhere(ql: ObjectQL, record: ConnectorConnectionRecord): Promise<void> {
    await ql.update(
        CONNECTOR_CONNECTION_OBJECT,
        { id: record.id, refresh_token: 'dummy-rt-elsewhere', status: 'connected', status_reason: null, revision: record.revision + 1 },
        { context: SYSTEM } as never,
    );
}

describe('ADR-0143 D4 — a refresh is written only over the revision it read', () => {
    it('writes a rotated token and raises the revision when the row has not moved', async () => {
        const ql = await dataEngine();
        const { store, record } = await connected(ql);
        const expiresAt = new Date('2030-01-01T00:00:00.000Z');
        expect(await store.recordRefresh(record, { refreshToken: 'dummy-rt-2', scopes: 'crm.read', expiresAt })).toBe(true);
        const now = (await store.read('org_a', 'crm'))!;
        expect(now).toMatchObject({ revision: record.revision + 1, scopes: 'crm.read', expiresAt: expiresAt.toISOString() });
        expect(await store.resolveRefreshToken(now)).toBe('dummy-rt-2');
    });

    it('a refresh that rotates nothing keeps the token and the revision, and still writes the expiry', async () => {
        const ql = await dataEngine();
        const { store, record } = await connected(ql);
        expect(await store.recordRefresh(record, { expiresAt: new Date('2030-01-01T00:00:00.000Z') })).toBe(true);
        const now = (await store.read('org_a', 'crm'))!;
        expect(now.revision).toBe(record.revision);
        expect(now.expiresAt).toBe('2030-01-01T00:00:00.000Z');
        expect(await store.resolveRefreshToken(now)).toBe('dummy-rt-1');
    });

    it('⛔ a reconnect landing between the refresh and its write is never overwritten by the stale rotation', async () => {
        const ql = await dataEngine();
        const { record } = await connected(ql);
        const store = new ConnectorConnectionStore(() => interleaved(ql, () => reconnectElsewhere(ql, record)));
        expect(await store.recordRefresh(record, { refreshToken: 'dummy-rt-stale' })).toBe(false);
        const now = (await store.read('org_a', 'crm'))!;
        expect(now.revision).toBe(record.revision + 1);
        expect(await store.resolveRefreshToken(now)).toBe('dummy-rt-elsewhere');
    });

    it('⛔ a row revoked since the refresh read it is not written', async () => {
        const ql = await dataEngine();
        const { store, record } = await connected(ql);
        expect(await store.revoke('org_a', 'crm')).toBe(true);
        expect(await store.recordRefresh(record, { refreshToken: 'dummy-rt-stale' })).toBe(false);
        expect(await store.read('org_a', 'crm')).toBeUndefined();
    });
});

describe('ADR-0143 D4 — "reconnect required" is written only over the revision that was refused', () => {
    it('marks the refused grant and drops its token when the row has not moved', async () => {
        const ql = await dataEngine();
        const { store, record } = await connected(ql);
        await store.markReconnectRequired(record, 'the vendor refused the grant');
        const now = (await store.read('org_a', 'crm'))!;
        expect(now).toMatchObject({ status: 'reconnect_required', statusReason: 'the vendor refused the grant', hasRefreshToken: false });
    });

    it('⛔ a reconnect landing between the refusal and its write keeps its fresh grant', async () => {
        const ql = await dataEngine();
        const { record } = await connected(ql);
        const store = new ConnectorConnectionStore(() => interleaved(ql, () => reconnectElsewhere(ql, record)));
        await store.markReconnectRequired(record, 'the vendor refused the grant');
        const now = (await store.read('org_a', 'crm'))!;
        expect(now).toMatchObject({ status: 'connected', revision: record.revision + 1, hasRefreshToken: true });
        expect(await store.resolveRefreshToken(now)).toBe('dummy-rt-elsewhere');
    });
});

describe('ADR-0143 D5 — a reconnect is written only over the revision it read', () => {
    it('replaces the grant and raises the revision', async () => {
        const ql = await dataEngine();
        const { store, record } = await connected(ql);
        const again = await store.connect({ organizationId: 'org_a', connectorName: 'crm', refreshToken: 'dummy-rt-again' });
        expect(again.id).toBe(record.id);
        expect(again.revision).toBe(record.revision + 1);
        expect(await store.resolveRefreshToken(again)).toBe('dummy-rt-again');
    });

    it('⛔ a reconnect racing another one refuses 503 and keeps nothing of its own', async () => {
        const ql = await dataEngine();
        const { record } = await connected(ql);
        const store = new ConnectorConnectionStore(() => interleaved(ql, () => reconnectElsewhere(ql, record)));
        await expect(store.connect({ organizationId: 'org_a', connectorName: 'crm', refreshToken: 'dummy-rt-loser' }))
            .rejects.toMatchObject({ name: 'ConnectorCredentialUnavailableError', status: 503 });
        const now = (await store.read('org_a', 'crm'))!;
        expect(await store.resolveRefreshToken(now)).toBe('dummy-rt-elsewhere');
    });
});

describe('ADR-0143 D5 — a connection store that cannot be read refuses 503, never 500', () => {
    const unreadable = (): ConnectorCredentialEngine => ({
        find: async () => { throw new Error('dummy driver failure naming row 42'); },
        insert: async () => { throw new Error('not reached'); },
        update: async () => { throw new Error('not reached'); },
        delete: async () => { throw new Error('not reached'); },
    });

    it.each([
        ['connect', (s: ConnectorConnectionStore) => s.connect({ organizationId: 'org_a', connectorName: 'crm', refreshToken: 'dummy-rt' })],
        ['revoke', (s: ConnectorConnectionStore) => s.revoke('org_a', 'crm')],
    ] as const)('⛔ %s', async (_verb, act) => {
        const err = await act(new ConnectorConnectionStore(unreadable)).catch((e: unknown) => e);
        expect(err).toMatchObject({ name: 'ConnectorCredentialUnavailableError', status: 503 });
        expect(String((err as Error).message)).not.toContain('row 42');
    });
});
