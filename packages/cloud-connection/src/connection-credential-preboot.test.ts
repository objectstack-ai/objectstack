// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31554] The shared binding credential read BEFORE the kernel, for the
 * multi-node licence gate (`connection-credential-preboot.ts`).
 *
 * Pinned here:
 *  - it reads what a replica's plugin wrote: a real SQLite file sealed by one
 *    engine is read back by a fresh driver and the same key, with no schema
 *    sync, and the connection is disconnected before the call returns;
 *  - every failure is soft and closes what it opened: a database that never
 *    held the row, another key, an open that throws, an open that lands after
 *    the bound (closed when it lands), a read that hangs (closed at the bound);
 *    none throws, and no reason carries the credential;
 *  - only replicas declared over Redis open anything: no declaration, the
 *    in-process driver, no driver, or any other driver answers `not-shared`
 *    without calling `openDriver`.
 *
 * The values below are obvious dummies.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import type { StoredConnectionCredential } from './connection-credential-store.js';
import { SharedConnectionCredentialLedger } from './connection-credential-ledger.js';
import { readCloudBindingCredentialBeforeBoot } from './connection-credential-preboot.js';
import { SysCloudBindingCredential } from './sys-cloud-binding-credential.object.js';

const TOKEN = 'oscc_dummy_31554_preboot';
const FULL: StoredConnectionCredential = {
    runtimeToken: TOKEN,
    runtimeId: 'rt_31554',
    environmentId: 'env_31554',
    controlPlaneUrl: 'http://cloud.test',
    organizationId: 'org_31554',
    accountEmail: 'ops@example.test',
    boundAt: '2026-11-08T00:00:00.000Z',
};
const SHARED_ENV = { OS_CLUSTER_REPLICAS: '2', OS_CLUSTER_DRIVER: 'redis' };

let dir: string;
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A database file as a replica's plugin leaves it: both objects registered as the plugin's manifest does, synced, sealed with `key`. */
async function replicaDatabase(key: Buffer, credential: StoredConnectionCredential | null): Promise<string> {
    dir = mkdtempSync(join(tmpdir(), 'ccl-preboot-'));
    const filename = join(dir, 'shared.sqlite');
    const engine = new ObjectQL();
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
    await driver.connect();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registerObject(SysSecret as never, 'test');
    engine.registerObject(SysCloudBindingCredential as never, 'com.objectstack.cloud.connection.credential', 'sys');
    await engine.syncSchemas();
    engine.setCryptoProvider(new LocalCryptoProvider({ key }));
    if (credential) await new SharedConnectionCredentialLedger(() => engine as never).write(credential);
    await engine.close();
    return filename;
}

/** An `openDriver` over `filename` that records each driver it opened and each disconnect. */
function opener(filename: string) {
    const opened: SqlDriver[] = [];
    const disconnects = vi.fn();
    const openDriver = vi.fn(async () => {
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await driver.connect();
        const disconnect = driver.disconnect.bind(driver);
        driver.disconnect = async () => { disconnects(); await disconnect(); };
        opened.push(driver);
        return driver as never;
    });
    return { openDriver, opened, disconnects };
}

describe('[#31554] the pre-boot read finds what a replica wrote, and closes its connection', () => {
    it('reads the sealed row back through a fresh connection and the same key, then disconnects', async () => {
        const key = randomBytes(32);
        const filename = await replicaDatabase(key, FULL);
        const { openDriver, disconnects } = opener(filename);
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key }), timeoutMs: 10_000,
        });
        expect(result).toEqual({ status: 'read', credential: FULL });
        expect(openDriver).toHaveBeenCalledTimes(1);
        expect(disconnects).toHaveBeenCalledTimes(1);
    });

    it('a database where nothing is bound reads as no credential', async () => {
        const key = randomBytes(32);
        const { openDriver, disconnects } = opener(await replicaDatabase(key, null));
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key }), timeoutMs: 10_000,
        });
        expect(result).toEqual({ status: 'read', credential: null });
        expect(disconnects).toHaveBeenCalledTimes(1);
    });

    it('takes the cluster driver from the host when it is configured outside OS_CLUSTER_DRIVER', async () => {
        const key = randomBytes(32);
        const { openDriver } = opener(await replicaDatabase(key, FULL));
        const result = await readCloudBindingCredentialBeforeBoot({
            env: { OS_EXPECT_MULTI_NODE: 'true' }, clusterDriver: 'redis', openDriver,
            cryptoProvider: new LocalCryptoProvider({ key }), timeoutMs: 10_000,
        });
        expect(result).toEqual({ status: 'read', credential: FULL });
    });
});

describe('[#31554] every pre-boot failure is soft, bounded and closes what it opened', () => {
    it('a database that has never held the row (a first boot) is unavailable, not an error', async () => {
        dir = mkdtempSync(join(tmpdir(), 'ccl-preboot-'));
        const { openDriver, disconnects } = opener(join(dir, 'empty.sqlite'));
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }), timeoutMs: 10_000,
        });
        expect(result.status).toBe('unavailable');
        expect(result.status === 'unavailable' && result.reason).toMatch(/starts unbound/);
        expect(disconnects).toHaveBeenCalledTimes(1);
    });

    it('another key is unavailable and names the remedy, never the credential', async () => {
        const filename = await replicaDatabase(randomBytes(32), FULL);
        const { openDriver, disconnects } = opener(filename);
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }), timeoutMs: 10_000,
        });
        expect(result.status).toBe('unavailable');
        const reason = result.status === 'unavailable' ? result.reason : '';
        expect(reason).toContain('OS_SECRET_KEY');
        expect(reason).not.toContain(TOKEN);
        expect(disconnects).toHaveBeenCalledTimes(1);
    });

    it('an open that throws is unavailable', async () => {
        const openDriver = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.9:5432'); });
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }),
        });
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('ECONNREFUSED') });
    });

    it('an open that lands after the bound answers at the bound and is closed when it lands', async () => {
        const disconnect = vi.fn(async () => {});
        let land!: () => void;
        const landed = new Promise<void>((r) => { land = r; });
        const openDriver = vi.fn(() => new Promise<never>((resolve) => {
            setTimeout(() => { resolve({ disconnect, find: vi.fn() } as never); land(); }, 150);
        }));
        const started = Date.now();
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver, cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }), timeoutMs: 30,
        });
        expect(Date.now() - started).toBeLessThan(150);
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('within 30 ms') });
        expect(disconnect).not.toHaveBeenCalled();
        await landed;
        await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    });

    it('a read that hangs answers at the bound and closes the connection under it', async () => {
        // A real driver whose read never answers: the reader must not wait on it.
        const hanging = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        await hanging.connect();
        hanging.find = () => new Promise<never>(() => {});
        const close = hanging.disconnect.bind(hanging);
        const disconnect = vi.fn(async () => { await close(); });
        hanging.disconnect = disconnect;
        const result = await readCloudBindingCredentialBeforeBoot({
            env: SHARED_ENV, openDriver: async () => hanging as never,
            cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }), timeoutMs: 30,
        });
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('within 30 ms') });
        await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    });
});

describe('[#31554] only replicas declared over Redis open anything before boot', () => {
    const topologies: Array<[string, Record<string, string>]> = [
        ['no replicas declared, Redis configured', { OS_CLUSTER_DRIVER: 'redis' }],
        ['replicas declared over the in-process driver', { OS_CLUSTER_REPLICAS: '3', OS_CLUSTER_DRIVER: 'memory' }],
        ['replicas declared with no cluster driver', { OS_CLUSTER_REPLICAS: '3' }],
        ['replicas declared over a driver other than Redis', { OS_CLUSTER_REPLICAS: '3', OS_CLUSTER_DRIVER: 'postgres' }],
        ['replicas declared over an unknown driver', { OS_EXPECT_MULTI_NODE: 'true', OS_CLUSTER_DRIVER: 'nats-jetstream' }],
    ];

    it.each(topologies)('%s: not-shared, and openDriver is never called', async (_label, env) => {
        const openDriver = vi.fn(async () => { throw new Error('must not open'); });
        const result = await readCloudBindingCredentialBeforeBoot({
            env, openDriver, cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }),
        });
        expect(result).toEqual({ status: 'not-shared' });
        expect(openDriver).not.toHaveBeenCalled();
    });
});
