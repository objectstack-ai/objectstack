// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 D7] The connector credential source: a datasource borrows a
 * declared connector instance's credential through the kernel service this
 * plugin registers, resolved by the chain the connector itself uses.
 *
 *  - the plugin registers the source in `init()`, and names it in
 *    `providesServices`;
 *  - a borrow refuses an undeclared instance, a catalog descriptor, an
 *    instance with no credential and a disabled one (`422`), naming the fix;
 *  - a borrowed static credential resolves from the environment and from a
 *    stored `sys_connector_credential` row (a real ObjectQL over SQLite, so
 *    the `Field.secret` seam is the engine's), for each static kind;
 *  - a credential not set yet lends a handle whose `get` refuses `503` with
 *    the remedy, and answers once the credential is set — no new borrow;
 *  - a credential write is picked up without a `refresh()`; a value changed
 *    where the plugin cannot see it (the environment) is picked up by one;
 *  - nothing a refusal says carries the value.
 *
 * The values below are obvious dummies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import {
    CONNECTOR_CREDENTIAL_SOURCE_SERVICE,
    callWithBorrowedCredential,
    type IConnectorCredentialSource,
} from '@objectstack/types';

import { AutomationServicePlugin, type CredentialResolver } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { SysConnectorCredential } from './sys-connector-credential.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import { createConnectorCredentialSource } from './connector-credential-source.js';

const REF = 'DUMMY_SAP_TOKEN_D7';
const DUMMY_VALUE = 'dummy-value-d7-aaaa-0001';
const DUMMY_VALUE_2 = 'dummy-value-d7-bbbb-0002';
const DUMMY_ENV_VALUE = 'dummy-env-d7-cccc-0003';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Reversible stand-in cipher — the seam's behaviour is the engine's, not the cipher's. */
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

/** A provider-bound instance, as the registry serves it. */
function sap(overrides: Record<string, unknown> = {}) {
    return { name: 'sap_s4', label: 'SAP', type: 'api', provider: 'fake', providerConfig: {}, auth: { type: 'bearer', credentialRef: REF }, ...overrides };
}

const engines: ObjectQL[] = [];
const kernels: LiteKernel[] = [];
const envKeys: string[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
    for (const key of envKeys.splice(0)) delete process.env[key];
});

function setEnv(key: string, value: string): void {
    envKeys.push(key);
    process.env[key] = value;
}

async function dataEngine(): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    (ql as any).registry.registerObject(SysSecret as never, 'test');
    (ql as any).registry.registerObject(SysConnectorCredential as never, 'test');
    (ql as any).registry.registerObject(SysFlowCredential as never, 'test');
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    return ql;
}

/** Boot the plugin over `declared`, with a fake provider so the reconcile materializes. */
async function boot(declared: unknown[], opts: { credentialResolver?: CredentialResolver } = {}) {
    const ql = await dataEngine();
    const kernel = new LiteKernel({ logger: { level: 'error' } } as never);
    kernels.push(kernel);
    const plugin = new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: opts.credentialResolver ?? (() => undefined) });
    kernel.use(plugin);
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            ctx.registerService('data', ql);
            ctx.getService('automation').registerConnectorProvider('fake', (pctx: any) => ({
                def: { name: pctx.name, label: pctx.label, type: 'api', actions: [{ key: 'request', label: 'Request' }] },
                handlers: { request: async () => ({ status: 200, ok: true, body: {} }) },
            }));
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    const source = kernel.getService(CONNECTOR_CREDENTIAL_SOURCE_SERVICE) as IConnectorCredentialSource;
    return { plugin, engine, source, ql };
}

describe('[ADR-0015 D7] the plugin lends a declared instance\'s credential', () => {
    it('registers the source and declares it among the services init() provides', async () => {
        const { plugin, source } = await boot([sap()]);
        expect(plugin.providesServices).toContain(CONNECTOR_CREDENTIAL_SOURCE_SERVICE);
        expect(typeof source.borrow).toBe('function');
    });

    it('lends a bearer credential set as an environment variable', async () => {
        setEnv(REF, DUMMY_ENV_VALUE);
        const { source } = await boot([sap()]);
        const handle = await source.borrow('sap_s4');
        expect(handle.connector).toBe('sap_s4');
        await expect(handle.get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_ENV_VALUE } });
    });

    it('lends the api-key and basic kinds in the shape the connector sends them', async () => {
        setEnv(REF, DUMMY_ENV_VALUE);
        const { source } = await boot([
            sap({ name: 'keyed', auth: { type: 'api-key', credentialRef: REF } }),
            sap({ name: 'keyed_param', auth: { type: 'api-key', credentialRef: REF, headerName: 'apikey', paramName: 'key' } }),
            sap({ name: 'basic', auth: { type: 'basic', username: 'svc_reader', credentialRef: REF } }),
        ]);
        await expect((await source.borrow('keyed')).get()).resolves.toEqual({
            auth: { type: 'api-key', key: DUMMY_ENV_VALUE, headerName: 'X-API-Key' },
        });
        await expect((await source.borrow('keyed_param')).get()).resolves.toEqual({
            auth: { type: 'api-key', key: DUMMY_ENV_VALUE, headerName: 'apikey', paramName: 'key' },
        });
        await expect((await source.borrow('basic')).get()).resolves.toEqual({
            auth: { type: 'basic', username: 'svc_reader', password: DUMMY_ENV_VALUE },
        });
    });

    it('lends before the credential is set: get refuses 503 with the remedy, then answers once it is set — and a write is picked up with no refresh', async () => {
        const { source, engine } = await boot([sap()]);
        const handle = await source.borrow('sap_s4');

        const missing = await handle.get().catch((e: Error) => e);
        expect(missing).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect((missing as Error).message).toContain(`credential '${REF}' is not set`);
        expect((missing as Error).message).toContain('Setup → Connector credentials');

        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: { userId: 'usr_admin' } as never });
        await expect(handle.get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_VALUE } });

        // A second write: the handle re-resolves on its next get, no refresh asked.
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: { userId: 'usr_admin' } as never });
        await expect(handle.get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_VALUE_2 } });
    });

    it('picks up a value changed where the plugin cannot see it on refresh — the driver\'s 401 path', async () => {
        setEnv(REF, DUMMY_ENV_VALUE);
        const { source } = await boot([sap()]);
        const handle = await source.borrow('sap_s4');
        await expect(handle.get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_ENV_VALUE } });
        setEnv(REF, DUMMY_VALUE_2); // rotated outside the door
        const sent: string[] = [];
        const result = await callWithBorrowedCredential(handle, async (auth) => {
            const token = auth.type === 'bearer' ? auth.token : '';
            sent.push(token);
            return { status: token === DUMMY_VALUE_2 ? 200 : 401 };
        });
        expect(result).toEqual({ status: 200 });
        expect(sent).toEqual([DUMMY_ENV_VALUE, DUMMY_VALUE_2]);
    });

    it.each([
        ['an undeclared instance', [], 'is not declared in this stack\'s connectors'],
        ['a catalog descriptor', [{ name: 'sap_s4', label: 'SAP', type: 'api' }], 'declares no provider'],
        ['an instance with no credential', [sap({ auth: { type: 'none' } })], 'declares no auth credential'],
        ['an instance with no auth at all', [sap({ auth: undefined })], 'declares no auth credential'],
        ['a disabled instance', [sap({ enabled: false })], 'is disabled (enabled: false)'],
    ])('refuses to lend %s (422, naming the fix)', async (_label, declared, phrase) => {
        const { source } = await boot(declared as unknown[]);
        const refusal = await source.borrow('sap_s4').catch((e: Error) => e);
        expect(refusal).toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
        expect((refusal as Error).message).toContain("connector instance 'sap_s4'");
        expect((refusal as Error).message).toContain(phrase);
    });
});

describe('[ADR-0015 D7] createConnectorCredentialSource — the refusals of a handle', () => {
    const entry = sap();
    const deps = (over: Partial<Parameters<typeof createConnectorCredentialSource>[0]> = {}) => createConnectorCredentialSource({
        readDeclared: async () => [entry],
        chain: async () => ({ env: () => DUMMY_VALUE }),
        vaultWired: () => false,
        generation: () => 0,
        ...over,
    });

    it('answers 503 when the declaration cannot be read at borrow', async () => {
        const source = deps({ readDeclared: async () => { throw new Error('protocol down'); } });
        await expect(source.borrow('sap_s4')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    });

    it('answers 503 on get when the instance stopped being declared after the borrow', async () => {
        let declared: unknown[] = [entry];
        let generation = 0;
        const source = deps({ readDeclared: async () => declared, generation: () => generation });
        const handle = await source.borrow('sap_s4');
        await expect(handle.get()).resolves.toMatchObject({ auth: { token: DUMMY_VALUE } });
        declared = [];
        generation += 1;
        await expect(handle.get()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    });

    it('withholds a host resolver\'s own message, which may carry a value', async () => {
        const source = deps({ chain: async () => ({ env: () => undefined, vault: () => { throw new Error(`vault said ${DUMMY_VALUE}`); } }) });
        const handle = await source.borrow('sap_s4');
        const err = await handle.get().catch((e: Error) => e);
        expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect((err as Error).message).toContain("credential 'DUMMY_SAP_TOKEN_D7'");
        expect((err as Error).message).not.toContain(DUMMY_VALUE);
    });

    it('answers 503 when the tenancy posture cannot be read', async () => {
        const source = deps({ chain: async () => { throw new Error('tenancy down'); } });
        const handle = await source.borrow('sap_s4');
        await expect(handle.get()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    });

    it('shares one resolution between concurrent gets', async () => {
        let reads = 0;
        const source = deps({ chain: async () => { reads += 1; return { env: () => DUMMY_VALUE }; } });
        const handle = await source.borrow('sap_s4');
        await Promise.all([handle.get(), handle.get(), handle.refresh()]);
        expect(reads).toBe(1);
    });
});
