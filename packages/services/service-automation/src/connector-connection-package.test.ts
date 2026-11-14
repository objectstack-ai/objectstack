// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4, #31699] The `sys_connector_connection` store reads and writes
// one instance by `(package, name)`, over a real ObjectQL engine (SQLite, a
// test crypto provider), with the key `(organization_id, connector_package,
// connector_name)`. A row naming no package answers a package's instance only
// where the name's durable resolution binds it to that package (or no registry
// can judge it), and is adopted by a connect; a row of a name two packages hold
// is no package's; two rows answering one instance are refused, never picked.
// The values below are obvious dummies.

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

import {
    CONNECTOR_CONNECTION_OBJECT,
    ConnectorConnectionConflictError,
    ConnectorConnectionStore,
    type ConnectorNullRowHolder,
} from './connector-connections.js';
import type { ConnectorCredentialEngine } from './connector-credentials.js';
import { SysConnectorConnection } from './sys-connector-connection.object.js';

const SYSTEM = { isSystem: true } as const;
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

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

/** The durable resolution of the name, as the plugin's resolver answers it. */
const resolvedTo = (packageId: string): ConnectorNullRowHolder => () => ({
    status: 'resolved', item: {}, holder: { kind: 'package', packageId } as never, via: 'unique-holder',
});
const environmentHolds: ConnectorNullRowHolder = () => ({ status: 'resolved', item: {}, holder: { kind: 'environment' }, via: 'environment' });
const twoHolders: ConnectorNullRowHolder = (name) => ({
    status: 'refused', reason: 'ambiguous-in-environment', type: 'connector', name, callerPackageId: null,
    candidates: [{ kind: 'package', packageId: A } as never, { kind: 'package', packageId: B } as never],
    message: 'two holders',
});

async function insertRow(ql: ObjectQL, id: string, pkg: string | null, org = 'org_a'): Promise<void> {
    await ql.insert(CONNECTOR_CONNECTION_OBJECT, {
        id, organization_id: org, connector_name: 'crm', connector_package: pkg,
        grant: 'authorization_code', status: 'connected', revision: 1,
    }, { context: SYSTEM } as never);
}

async function packages(ql: ObjectQL, org = 'org_a'): Promise<Array<string | null>> {
    const rows = (await ql.find(CONNECTOR_CONNECTION_OBJECT, { where: { organization_id: org }, context: SYSTEM } as never)) as Array<Record<string, unknown>>;
    return rows.map((r) => (r.connector_package as string | null) ?? null).sort();
}

function storeOver(ql: ObjectQL, holder?: ConnectorNullRowHolder): ConnectorConnectionStore {
    return new ConnectorConnectionStore(() => ql as unknown as ConnectorCredentialEngine, holder);
}

describe('[#31699] one instance is read and written by its package', () => {
    it('a connect names the instance\'s package; that package reads it, the environment\'s instance does not', async () => {
        const ql = await dataEngine();
        const store = storeOver(ql, resolvedTo(A));
        const record = await store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: A, refreshToken: 'dummy-rt' });
        expect(record.packageId).toBe(A);
        expect((await store.read('org_a', 'crm', A))?.id).toBe(record.id);
        expect(await store.read('org_a', 'crm', null)).toBeUndefined();
        expect((await store.read('org_a', 'crm'))?.id).toBe(record.id);
    });

    it('an environment instance (package null) writes and reads the row naming none', async () => {
        const ql = await dataEngine();
        const store = storeOver(ql, environmentHolds);
        const record = await store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: null, refreshToken: 'dummy-rt' });
        expect(record.packageId).toBeNull();
        expect((await store.read('org_a', 'crm', null))?.id).toBe(record.id);
        // The environment's item answers the name: its row is not a package's.
        expect(await store.read('org_a', 'crm', A)).toBeUndefined();
    });
});

describe('[#31699, design review M2] a row naming no package is the package\'s the name resolves to, and a connect adopts it', () => {
    it('one holder: the package reads the row, and a reconnect stamps it in place: one row, never two', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        const store = storeOver(ql, resolvedTo(A));
        expect((await store.read('org_a', 'crm', A))?.id).toBe('c0');
        const record = await store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: A, refreshToken: 'dummy-rt-2' });
        expect(record.id).toBe('c0');
        expect(record.packageId).toBe(A);
        expect(await packages(ql)).toEqual([A]);
    });

    it('no registry to judge it: the row answers as it did before the package column', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        expect((await storeOver(ql).read('org_a', 'crm', A))?.id).toBe('c0');
    });

    it('the name resolves to another package: the row is not this package\'s', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        expect(await storeOver(ql, resolvedTo(B)).read('org_a', 'crm', A)).toBeUndefined();
    });
});

describe('[#31699, ADR-0150 red line 2] two packages hold the name: a row naming none is no one package\'s', () => {
    it('it is all a package has: the read is refused 409, naming the bind, and nothing is written', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        const store = storeOver(ql, twoHolders);
        const refusal = await store.readOrRefuse('org_a', 'crm', A).then(() => undefined, (e: unknown) => e);
        expect(refusal).toBeInstanceOf(ConnectorConnectionConflictError);
        expect((refusal as ConnectorConnectionConflictError).status).toBe(409);
        expect((refusal as Error).message).toMatch(/os migrate stored-references bind/);
        await expect(store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: A, refreshToken: 'x' }))
            .rejects.toBeInstanceOf(ConnectorConnectionConflictError);
        expect(await packages(ql)).toEqual([null]);
    });

    it('beside the package\'s own row: the own row answers; a revoke of the package leaves the row naming none', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        await insertRow(ql, 'c1', A);
        const store = storeOver(ql, twoHolders);
        expect((await store.read('org_a', 'crm', A))?.id).toBe('c1');
        expect(await store.revoke('org_a', 'crm', undefined, A)).toBe(true);
        expect(await packages(ql)).toEqual([null]);
    });

    it('each package connects its own instance in one organization (the key admits both)', async () => {
        const ql = await dataEngine();
        const store = storeOver(ql, twoHolders);
        await store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: A, refreshToken: 'a' });
        await store.connect({ organizationId: 'org_a', connectorName: 'crm', packageId: B, refreshToken: 'b' });
        expect(await packages(ql)).toEqual([A, B]);
        expect((await store.read('org_a', 'crm', A))?.packageId).toBe(A);
        expect((await store.read('org_a', 'crm', B))?.packageId).toBe(B);
        // A caller that knows only the name gets no pick of the two.
        await expect(store.read('org_a', 'crm')).rejects.toBeInstanceOf(ConnectorConnectionConflictError);
    });
});

describe('[#31699, design review S2] two rows answering one instance are refused, never picked by row order', () => {
    it('the package\'s row and a row naming none it adopts: the read refuses; a revoke removes both', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null);
        await insertRow(ql, 'c1', A);
        const store = storeOver(ql, resolvedTo(A));
        await expect(store.read('org_a', 'crm', A)).rejects.toThrow(/has 2 connections in this organization/);
        expect(await store.revoke('org_a', 'crm', undefined, A)).toBe(true);
        expect(await packages(ql)).toEqual([]);
    });

    it('listFor counts one entry per organization, and one whose read is refused carries the refusal, never a row as its connection', async () => {
        const ql = await dataEngine();
        await insertRow(ql, 'c0', null, 'org_a');
        await insertRow(ql, 'c1', A, 'org_a');
        await insertRow(ql, 'c2', A, 'org_b');
        await insertRow(ql, 'c3', null, 'org_c');
        const listed = await storeOver(ql, resolvedTo(A)).listFor('crm', A);
        const byOrganization = Object.fromEntries(listed.map((r) => [r.organizationId, r.conflict]));
        expect(Object.keys(byOrganization).sort()).toEqual(['org_a', 'org_b', 'org_c']);
        expect(byOrganization.org_a).toContain('has 2 connections');
        expect(byOrganization.org_b).toBeUndefined();
        expect(byOrganization.org_c).toBeUndefined();
        // Two holders: org_c's package-less row is no package's, listed with the read's refusal.
        const twoHeld = await storeOver(ql, twoHolders).listFor('crm', A);
        expect(twoHeld.find((r) => r.organizationId === 'org_c')?.conflict).toContain('stored-references bind');
    });
});
