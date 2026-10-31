// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27237] The connector credential store, the resolver chain and the
 * reconcile a credential write runs (ruling A on #27230) — on a real ObjectQL
 * over SQLite, so the `Field.secret` seam (#7799) is the engine's, not a
 * double's.
 *
 * The acceptance list, one block each:
 *
 *  - a missing reference degrades the instance naming it; a set → ready, with
 *    no restart; a clear → degraded again;
 *  - the value appears nowhere: not in a log record, the listing, `GET
 *    /connectors`' descriptors, an engine read of the object, or the audit's
 *    copy of the row;
 *  - an environment variable of the same name wins, and the listing says
 *    `source: env`;
 *  - a wrong value → the instance degraded and the row `rejected` (ruling on
 *    #27237, comment 6470087293): at materialization (the mcp shape) and on
 *    the first call answering 401 / 403 (the rest / openapi shape);
 *  - the seat review's round (#27344): only a stored value holds its instance
 *    (an environment or vault one retries on the backoff, and recovers),
 *    `rejected` survives a re-materialization and a restart until an upstream
 *    accepts the value, a value spelled as a secret handle is refused, door
 *    writes serialize, the no-crypto refusal writes nothing, and a walled
 *    posture leaves the store out of the chain.
 *
 * The values below are obvious dummies.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { collectMaskedReadFields } from '@objectstack/objectql/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import {
    ConnectorCredentialRejectedError,
    type Connector,
    type ConnectorProviderContext,
    type ConnectorProviderFactory,
} from '@objectstack/spec/integration';

import { AutomationServicePlugin, type CredentialResolver } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { SysConnectorCredential } from './sys-connector-credential.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import {
    CONNECTOR_CREDENTIAL_OBJECT,
    ConnectorCredentialStore,
    credentialForms,
    upstreamRefusalMessage,
    withoutCredential,
    withoutCredentialThrown,
} from './connector-credentials.js';

const REF = 'DUMMY_BILLING_TOKEN_27237';
const DUMMY_VALUE = 'dummy-value-aaaa-0001';
const DUMMY_VALUE_2 = 'dummy-value-bbbb-0002';
const DUMMY_ENV_VALUE = 'dummy-env-value-cccc-0003';
const SYSTEM = { isSystem: true } as const;

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

/** A provider-bound instance naming {@link REF}. */
function billing(name = 'billing') {
    return {
        name,
        label: name,
        type: 'api',
        provider: 'fake',
        providerConfig: {},
        auth: { type: 'bearer', credentialRef: REF },
        _packageId: 'com.example.billing',
    };
}

/**
 * A fake provider in the shape of the real ones: `request` answers `{ status,
 * ok, body }` like rest / openapi, and `rejectAtMaterialization` throws the
 * marker like mcp. The upstream ECHOES the token it was sent, so a scrub that
 * stopped working shows up.
 */
function fakeProvider() {
    const state = {
        materialized: [] as ConnectorProviderContext[],
        rejectAtMaterialization: false,
        /** Answer `credentialVerified`, as mcp does when its handshake carried the credential. */
        verifyAtMaterialization: false,
        callStatus: 200,
    };
    const tokenOf = (ctx: ConnectorProviderContext) => (ctx.auth?.type === 'bearer' ? ctx.auth.token : undefined);
    const factory: ConnectorProviderFactory = (ctx) => {
        state.materialized.push(ctx);
        if (state.rejectAtMaterialization) {
            throw new ConnectorCredentialRejectedError(
                `fake provider: connector '${ctx.name}' was refused by its server (HTTP 401): invalid token ${tokenOf(ctx)}`,
                401,
            );
        }
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                // As the rest provider does: the runtime def carries the
                // resolved auth, token included — what a descriptor must not leak.
                authentication: ctx.auth ?? { type: 'none' },
                actions: [{ key: 'request', label: 'Request' }],
            } as unknown as Connector,
            handlers: {
                request: async () => (state.callStatus === 200
                    ? { status: 200, ok: true, body: { invoices: [] } }
                    : { status: state.callStatus, ok: false, body: { message: `token ${tokenOf(ctx)} is not valid` } }),
            },
            ...(state.verifyAtMaterialization ? { credentialVerified: true } : {}),
        };
    };
    return { factory, state, tokenOf };
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
    vi.restoreAllMocks();
});

/**
 * Everything the process prints while a test runs — the kernel logger at
 * `debug` in JSON (stdout and stderr) and any `console` call.
 */
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

async function dataEngine(opts: { crypto?: boolean } = {}): Promise<ObjectQL> {
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
    if (opts.crypto !== false) ql.setCryptoProvider(fakeCrypto());
    return ql;
}

async function boot(
    declared: unknown[],
    opts: {
        credentialResolver?: CredentialResolver;
        /** Reuse a data engine — a restart over the same database. */
        ql?: ObjectQL;
        crypto?: boolean;
        /** Register a `tenancy` service with this posture. */
        posture?: string;
        provider?: ReturnType<typeof fakeProvider>;
    } = {},
) {
    const ql = opts.ql ?? await dataEngine({ crypto: opts.crypto });
    const provider = opts.provider ?? fakeProvider();
    const kernel = new LiteKernel({ logger: { level: 'debug', format: 'json' } } as never);
    kernels.push(kernel);
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: opts.credentialResolver ?? (() => undefined) }));
    let captured: any;
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            // The declared connectors, as the registry serves them; the data
            // engine under `data`, where the plugin's resolution finds it.
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            ctx.registerService('data', ql);
            if (opts.posture !== undefined) ctx.registerService('tenancy', { posture: opts.posture });
            ctx.getService('automation').registerConnectorProvider('fake', provider.factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    const call = async (name = 'billing') => engine.resolveConnectorAction(name, 'request')!({}, {} as never);
    /** A soft reconcile with nothing changed — the `metadata:reloaded` path. */
    const reload = async () => {
        await captured.trigger('metadata:reloaded');
        await flush();
    };
    return { ql, engine, provider, call, reload, kernel };
}


const ADMIN = { userId: 'usr_admin_27237' } as never;

describe('[#27237] a missing credential degrades its instance; setting it materializes it, no restart', () => {
    it('missing → degraded naming the reference; set → ready; clear → degraded again', async () => {
        const { engine, provider, ql, call, reload } = await boot([billing()]);

        // Missing: no arm of the chain answers — degraded, named, factory never asked.
        expect(provider.state.materialized).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('billing')).toContain(`credential '${REF}'`);
        expect(engine.getConnectorDegradedReason('billing')).toContain(`/api/v1/automation/connectors/credential-refs/${REF}`);
        const [missing] = await engine.listConnectorCredentialRefs();
        expect(missing).toMatchObject({ ref: REF, status: 'missing', source: null, writable: true, declared: true });
        expect(missing.connectors).toEqual([
            expect.objectContaining({ name: 'billing', packageId: 'com.example.billing', state: 'degraded' }),
        ]);

        // Set: the same kernel, the instance materializes with the value. The
        // write carries the caller's user id, which the audit stamps record.
        const insert = vi.spyOn(ql, 'insert');
        const entry = await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        expect(insert).toHaveBeenCalledWith(
            CONNECTOR_CREDENTIAL_OBJECT,
            expect.anything(),
            { context: expect.objectContaining({ isSystem: true, userId: 'usr_admin_27237' }) },
        );
        expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();
        expect(engine.getRegisteredConnectors()).toContain('billing');
        expect(provider.state.materialized).toHaveLength(1);
        expect(provider.tokenOf(provider.state.materialized[0])).toBe(DUMMY_VALUE);
        expect(entry).toMatchObject({ ref: REF, status: 'set', source: 'object', updatedBy: 'usr_admin_27237' });
        expect(entry.updatedAt).toBeDefined();
        expect(entry.connectors[0]).toMatchObject({ name: 'billing', state: 'ready' });
        // Materializing sent nothing upstream (the rest shape), so nothing is verified yet…
        expect(entry.lastVerifiedAt).toBeUndefined();
        // …until a call answered 2xx stamps the time on the row, which is `set`.
        expect(await call()).toMatchObject({ status: 200 });
        await reload(); // the reconcile queue has run the call's bookkeeping by now
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'set', lastVerifiedAt: expect.any(String) });

        // Set again: a new revision re-materializes with the new value.
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        expect(provider.state.materialized).toHaveLength(2);
        expect(provider.tokenOf(provider.state.materialized[1])).toBe(DUMMY_VALUE_2);

        // Clear: torn down and degraded again, naming the reference.
        const cleared = await engine.clearConnectorCredential({ ref: REF, context: ADMIN });
        expect(cleared).toMatchObject({ ref: REF, status: 'missing', source: null });
        expect(engine.getConnectorDegradedReason('billing')).toContain(`credential '${REF}'`);
    });

    it('refuses an undeclared reference (404), an empty value (400), and a clear of nothing stored (404) — writing nothing', async () => {
        const { engine, ql } = await boot([billing()]);
        await expect(engine.setConnectorCredential({ ref: 'NOT_DECLARED_ANYWHERE', value: DUMMY_VALUE, context: ADMIN }))
            .rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        await expect(engine.setConnectorCredential({ ref: REF, value: '', context: ADMIN }))
            .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        await expect(engine.clearConnectorCredential({ ref: REF, context: ADMIN }))
            .rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        expect(await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)).toHaveLength(0);
    });
});

// ADR-0143 D2.3 — an `alipay-v3` instance names two references: the private
// key it signs with and the Alipay public key it verifies responses with. The
// door lists both against the instance, and setting or replacing either one
// re-materializes it.
describe('[#26710] a signed instance names its vendor public key as a second reference', () => {
    const vectors = new URL('../test-vectors/alipay-v3/', import.meta.url);
    const PRIVATE_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64', vectors), 'ascii').trim();
    const PUBLIC_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-public-key.spki.b64', vectors), 'ascii').trim();
    const alipay = {
        name: 'alipay_pay',
        label: 'Alipay',
        type: 'api',
        provider: 'fake',
        providerConfig: {},
        auth: { type: 'signed', scheme: 'alipay-v3', keyId: '2021000000000000', credentialRef: 'ALIPAY_APP_PRIVATE_KEY', vendorPublicKeyRef: 'ALIPAY_PUBLIC_KEY' },
        _packageId: 'com.example.alipay',
    };

    it('lists both references; the public key missing degrades the instance, and setting or replacing it materializes it', async () => {
        const materialized: ConnectorProviderContext[] = [];
        const signing: ConnectorProviderFactory = (ctx) => {
            materialized.push(ctx);
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [] } as unknown as Connector,
                handlers: {},
                requestSignerApplied: true,
            };
        };
        const provider = { ...fakeProvider(), factory: signing };
        const { engine } = await boot([alipay], {
            provider,
            credentialResolver: (ref) => (ref === 'ALIPAY_APP_PRIVATE_KEY' ? PRIVATE_KEY : undefined),
        });
        expect(materialized).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('alipay_pay')).toContain("credential 'ALIPAY_PUBLIC_KEY'");
        const listed = Object.fromEntries((await engine.listConnectorCredentialRefs()).map((e) => [e.ref, e]));
        expect(listed.ALIPAY_PUBLIC_KEY).toMatchObject({ status: 'missing', declared: true });
        expect(listed.ALIPAY_PUBLIC_KEY!.connectors).toEqual([expect.objectContaining({ name: 'alipay_pay', packageId: 'com.example.alipay' })]);
        expect(listed.ALIPAY_APP_PRIVATE_KEY!.connectors).toEqual([expect.objectContaining({ name: 'alipay_pay' })]);

        await engine.setConnectorCredential({ ref: 'ALIPAY_PUBLIC_KEY', value: PUBLIC_KEY, context: ADMIN });
        expect(engine.getConnectorDegradedReason('alipay_pay')).toBeUndefined();
        expect(materialized).toHaveLength(1);
        expect(materialized[0]!.requestSigner?.scheme).toBe('alipay-v3');

        // A replaced public key is a new revision: the instance re-materializes.
        await engine.setConnectorCredential({ ref: 'ALIPAY_PUBLIC_KEY', value: `\n${PUBLIC_KEY}\n`, context: ADMIN });
        expect(materialized).toHaveLength(2);
    });
});

describe('[#27237] the value appears nowhere it is not used', () => {
    it('not in a log record, the listing, the connector descriptors or an engine read of the row', async () => {
        const out = captureOutput();
        const { engine, ql } = await boot([billing()]);
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });

        const listing = JSON.stringify(await engine.listConnectorCredentialRefs());
        const descriptors = JSON.stringify(engine.getConnectorDescriptors());
        const rows = (await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)) as any[];
        await engine.clearConnectorCredential({ ref: REF, context: ADMIN });

        expect(rows).toHaveLength(1);
        expect(rows[0].value).not.toBe(DUMMY_VALUE_2); // masked on the engine's read
        for (const [where, text] of [
            ['listing', listing],
            ['descriptors', descriptors],
            ['engine read', JSON.stringify(rows)],
            ['logs', out.text()],
        ] as const) {
            expect(text.includes(DUMMY_VALUE), where).toBe(false);
            expect(text.includes(DUMMY_VALUE_2), where).toBe(false);
        }
        // The logs did record the writes — the pin is not passing on silence.
        expect(out.text()).toContain(`connector credential '${REF}' set (revision 2) by user 'usr_admin_27237'`);
    });

    it("the audit copy masks it: `value` is among the fields plugin-audit's writers mask", () => {
        // plugin-audit masks exactly `collectMaskedReadFields(objectDef)` on
        // every side of a row it records (`audit-writers.ts`, #6656).
        expect(collectMaskedReadFields(SysConnectorCredential as never)).toEqual(['value']);
    });
});

describe('[#27237] an environment variable of the same name wins', () => {
    it('the listing says `source: env`, the instance gets the env value, and the door will not store a shadowed value', async () => {
        process.env[REF] = DUMMY_ENV_VALUE;
        envKeys.push(REF);
        const { engine, provider } = await boot([billing()]);
        expect(provider.tokenOf(provider.state.materialized[0])).toBe(DUMMY_ENV_VALUE);
        const [entry] = await engine.listConnectorCredentialRefs();
        expect(entry).toMatchObject({ ref: REF, status: 'set', source: 'env', writable: false });
        await expect(engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN }))
            .rejects.toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
    });

    it('order: env, then the stored row, then the host resolver', async () => {
        const vault = vi.fn(async (ref: string) => (ref === REF ? 'dummy-vault-value-dddd-0004' : undefined));
        const { engine, provider } = await boot([billing()], { credentialResolver: vault });
        // Only the vault answers: it is the source.
        expect(provider.tokenOf(provider.state.materialized[0])).toBe('dummy-vault-value-dddd-0004');
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ source: 'vault', status: 'set' });
        // A stored row is read before the vault.
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        expect(provider.tokenOf(provider.state.materialized[provider.state.materialized.length - 1])).toBe(DUMMY_VALUE);
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ source: 'object', status: 'set' });
    });
});

describe('[#27237] a wrong value degrades the instance and marks the row rejected', () => {
    it('refused at materialization (the mcp shape): degraded, `rejected`, the reason scrubbed, never retried', async () => {
        const out = captureOutput();
        const { engine, provider, reload } = await boot([billing()]);
        provider.state.rejectAtMaterialization = true;
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });

        const reason = engine.getConnectorDegradedReason('billing');
        expect(reason).toContain('(HTTP 401)');
        expect(reason).toContain('[credential withheld]');
        const [entry] = await engine.listConnectorCredentialRefs();
        expect(entry).toMatchObject({ ref: REF, status: 'rejected', source: 'object' });
        expect(entry.statusReason).toContain('(HTTP 401)');

        // Held: a reconcile with nothing changed does not ask the upstream again.
        const attempts = provider.state.materialized.length;
        await reload();
        expect(provider.state.materialized).toHaveLength(attempts);
        provider.state.rejectAtMaterialization = false;

        // Setting it again is what re-attempts it.
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'set' });

        for (const text of [JSON.stringify(entry), reason ?? '', out.text()]) {
            expect(text.includes(DUMMY_VALUE)).toBe(false);
        }
    });

    it.each([401, 403])(
        'refused on the first call (the rest / openapi shape, HTTP %i): degraded, `rejected`, the call answered as it was',
        async (status) => {
            const out = captureOutput();
            const { engine, provider, call, reload } = await boot([billing()]);
            await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
            expect(await call()).toMatchObject({ status: 200 });
            expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();

            provider.state.callStatus = status;
            const answered = await call();
            expect(answered).toMatchObject({ status, ok: false });

            const reason = engine.getConnectorDegradedReason('billing');
            expect(reason).toContain(`(HTTP ${status}) on a call`);
            expect(reason).toContain(`credential '${REF}'`);
            expect(reason).toContain('[credential withheld]');
            expect(engine.resolveConnectorAction('billing', 'request')).toBeUndefined();
            const [entry] = await engine.listConnectorCredentialRefs();
            expect(entry).toMatchObject({ status: 'rejected', source: 'object' });
            expect(entry.statusReason).toBe(reason);

            // Held: a reconcile with nothing changed leaves it degraded.
            const attempts = provider.state.materialized.length;
            await reload();
            expect(provider.state.materialized).toHaveLength(attempts);
            expect(engine.getConnectorDegradedReason('billing')).toBe(reason);

            // Setting it again re-materializes it.
            provider.state.callStatus = 200;
            await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
            expect(await call()).toMatchObject({ status: 200 });
            expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'set' });

            for (const text of [JSON.stringify(entry), reason ?? '', out.text()]) {
                expect(text.includes(DUMMY_VALUE)).toBe(false);
            }
        },
    );
});

describe('[#27237] seat review r1: only a stored value holds its instance', () => {
    it('an environment value refused on a call retries on the backoff, says so, and recovers', async () => {
        process.env[REF] = DUMMY_ENV_VALUE;
        envKeys.push(REF);
        const out = captureOutput();
        const { engine, provider, call, reload } = await boot([billing()]);
        expect(await call()).toMatchObject({ status: 200 });

        provider.state.callStatus = 403;
        expect(await call()).toMatchObject({ status: 403 });
        const reason = engine.getConnectorDegradedReason('billing');
        expect(reason).toContain('(HTTP 403) on a call');
        expect(reason).toContain('The instance is retried with backoff.');
        // The listing reports the refusal, though there is no row to mark.
        const refused = await engine.listConnectorCredentialRefs();
        expect(refused[0]).toMatchObject({ ref: REF, source: 'env', status: 'rejected', statusReason: reason, writable: false });
        // On the backoff: the retry timer is armed for it (a held instance arms none).
        expect(out.text()).toContain('1 degraded connector instance(s); next retry in 5000ms');

        // The retry — the timer's own soft reconcile — re-materializes it, and it serves again.
        provider.state.callStatus = 200;
        const before = provider.state.materialized.length;
        await reload();
        expect(provider.state.materialized).toHaveLength(before + 1);
        expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();
        expect(await call()).toMatchObject({ status: 200 });
        await reload();
        // Still reported refused: a 2xx is no proof (the endpoint may not check the credential).
        const after = (await engine.listConnectorCredentialRefs())[0];
        expect(after).toMatchObject({ source: 'env', status: 'rejected' });
        expect(after.connectors[0]).toMatchObject({ state: 'ready' });
    });

    it("a vault value refused at materialization retries, and a rotation the provider proves recovers it", async () => {
        let vaultValue = 'dummy-vault-value-eeee-0005';
        const vault = vi.fn(async (ref: string) => (ref === REF ? vaultValue : undefined));
        const provider = fakeProvider();
        provider.state.rejectAtMaterialization = true;
        const { engine, reload } = await boot([billing()], { credentialResolver: vault, provider });
        expect(engine.getConnectorDegradedReason('billing')).toContain('(HTTP 401)');
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ source: 'vault', status: 'rejected' });

        // Rotated in the vault, where this process cannot see it: the retry picks it up.
        vaultValue = 'dummy-vault-value-ffff-0006';
        provider.state.rejectAtMaterialization = false;
        provider.state.verifyAtMaterialization = true;
        await reload();
        expect(provider.tokenOf(provider.state.materialized[provider.state.materialized.length - 1])).toBe('dummy-vault-value-ffff-0006');
        expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();
        // The provider proved it while materializing: no call needed.
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ source: 'vault', status: 'set' });
    });

    it('a stored value refused on a call holds its instance; a restart lifts the hold, and the row stays `rejected` — a 2xx call does not clear it', async () => {
        const first = await boot([billing()]);
        await first.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        const set = (await first.engine.listConnectorCredentialRefs())[0];
        first.provider.state.callStatus = 401;
        await first.call();
        const reason = first.engine.getConnectorDegradedReason('billing');
        expect(reason).toContain(`until credential '${REF}' is set again or the server restarts`);
        const rejected = (await first.engine.listConnectorCredentialRefs())[0];
        expect(rejected).toMatchObject({ status: 'rejected', source: 'object', statusReason: reason });
        // Marking it moved neither who set it nor when.
        expect(rejected.updatedAt).toBe(set.updatedAt);
        expect(rejected.updatedBy).toBe('usr_admin_27237');

        // Held: the reconcile a retry would run leaves it alone.
        const attempts = first.provider.state.materialized.length;
        await first.reload();
        expect(first.provider.state.materialized).toHaveLength(attempts);
        await first.kernel.shutdown();

        // Restart over the same database: the instance materializes again (rest
        // sends nothing while materializing), and the row is still `rejected`.
        const second = await boot([billing()], { ql: first.ql });
        expect(second.provider.state.materialized).toHaveLength(1);
        expect(second.engine.getConnectorDegradedReason('billing')).toBeUndefined();
        expect((await second.engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'rejected', statusReason: reason });
        // A reconcile that re-materializes it changes nothing either.
        await second.reload();
        expect((await second.engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'rejected' });

        // A call answered 2xx is no proof — a public path or an operation with
        // `security: []` never checks the credential — so the row stays
        // `rejected`, its reason and its unverified time unmoved.
        expect(await second.call()).toMatchObject({ status: 200 });
        await second.reload(); // the reconcile queue has run the call's bookkeeping by now
        const afterCall = (await second.engine.listConnectorCredentialRefs())[0];
        expect(afterCall).toMatchObject({ status: 'rejected', source: 'object', statusReason: reason });
        expect(afterCall.lastVerifiedAt).toBeUndefined();

        // Setting it again is what clears it.
        await second.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        const reset = (await second.engine.listConnectorCredentialRefs())[0];
        expect(reset).toMatchObject({ status: 'set', source: 'object' });
        expect(reset.statusReason).toBeUndefined();
    });

    it('a provider that proves the credential while materializing (mcp) returns a `rejected` row to `set` on restart', async () => {
        const first = await boot([billing()]);
        await first.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        first.provider.state.callStatus = 401;
        await first.call();
        expect((await first.engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'rejected' });
        await first.kernel.shutdown();

        const provider = fakeProvider();
        provider.state.verifyAtMaterialization = true;
        const second = await boot([billing()], { ql: first.ql, provider });
        const entry = (await second.engine.listConnectorCredentialRefs())[0];
        expect(entry).toMatchObject({ status: 'set', source: 'object' });
        expect(entry.lastVerifiedAt).toBeDefined();
    });
});

describe('[#27237] seat review r1: the door refuses what it must, and serializes what it writes', () => {
    it("refuses a value spelled as a secret handle (400), writing nothing and not echoing it", async () => {
        const { engine, ql } = await boot([billing()]);
        const err = await engine.setConnectorCredential({ ref: REF, value: 'secret:sec_dummy_0007', context: ADMIN })
            .then(() => undefined, (e: unknown) => e as Error & { status?: number; code?: string });
        expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(err?.message).toContain("cannot start with 'secret:'");
        expect(err?.message.includes('sec_dummy_0007')).toBe(false);
        expect(await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)).toHaveLength(0);
    });

    it('two concurrent PUTs serialize: the instance ends on the value the store ends on', async () => {
        const { engine, provider, ql } = await boot([billing()]);
        await Promise.all([
            engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN }),
            engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN }),
        ]);
        const rows = (await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)) as Array<{ id: string; revision: number }>;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].revision)).toBe(2);
        const stored = await (ql as any).resolveSecretField(CONNECTOR_CREDENTIAL_OBJECT, rows[0].id, 'value');
        expect(stored).toBe(DUMMY_VALUE_2);
        expect(provider.state.materialized.map(provider.tokenOf)).toEqual([DUMMY_VALUE, DUMMY_VALUE_2]);
    });

    it('two writers inserting the first row at once (two replicas): one stores it, the other answers 409', async () => {
        const ql = await dataEngine();
        const replicas = [new ConnectorCredentialStore(() => ql as never), new ConnectorCredentialStore(() => ql as never)];
        const outcomes = await Promise.allSettled(
            replicas.map((store, i) => store.set({ ref: REF, value: i === 0 ? DUMMY_VALUE : DUMMY_VALUE_2, connectorNames: ['billing'], packageIds: [] })),
        );
        expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
        const refused = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
        expect(refused?.reason).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        for (const v of [DUMMY_VALUE, DUMMY_VALUE_2]) expect(String(refused?.reason?.message).includes(v)).toBe(false);
        expect(await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)).toHaveLength(1);
    });

    it('with no crypto provider registered: 503 SERVICE_UNAVAILABLE, no row written, the instance still degraded', async () => {
        const { engine, ql } = await boot([billing()], { crypto: false });
        const err = await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN })
            .then(() => undefined, (e: unknown) => e as Error);
        expect(err).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(err?.message).toContain('needs a crypto provider');
        expect(err?.message.includes(DUMMY_VALUE)).toBe(false);
        expect(await ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('billing')).toContain(`credential '${REF}' is not set`);
    });
});

describe('[#27237] seat review r1: under a walled posture the store is not in the chain', () => {
    it.each(['group', 'isolated'])('%s: a stored row is not read, and the door refuses to write, naming the posture', async (posture) => {
        const single = await boot([billing()]);
        await single.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await single.kernel.shutdown();

        const walled = await boot([billing()], { ql: single.ql, posture });
        // The row is there, and nothing resolves from it.
        expect(walled.provider.state.materialized).toHaveLength(0);
        expect(walled.engine.getConnectorDegradedReason('billing')).toContain(`credential '${REF}' is not set`);
        const [entry] = await walled.engine.listConnectorCredentialRefs();
        expect(entry).toMatchObject({ ref: REF, status: 'missing', source: null, writable: false });
        for (const write of [
            () => walled.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN }),
            () => walled.engine.clearConnectorCredential({ ref: REF, context: ADMIN }),
        ]) {
            const err = await write().then(() => undefined, (e: unknown) => e as Error);
            expect(err).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
            expect(err?.message).toContain(`'${posture}' tenancy posture`);
        }
        const rows = (await single.ql.find(CONNECTOR_CREDENTIAL_OBJECT, { context: SYSTEM } as never)) as Array<{ revision: number }>;
        expect(rows.map((r) => Number(r.revision))).toEqual([1]);
    });

    it('an environment variable still resolves under a walled posture', async () => {
        process.env[REF] = DUMMY_ENV_VALUE;
        envKeys.push(REF);
        const { engine, provider } = await boot([billing()], { posture: 'isolated' });
        expect(provider.tokenOf(provider.state.materialized[0])).toBe(DUMMY_ENV_VALUE);
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ source: 'env', status: 'set', writable: false });
    });
});

describe('[#27237] contract review: an encoded spelling of the value is withheld too', () => {
    const USERNAME = 'svc_dummy_27237';
    // Characters that URL-encode, so the encoded spelling differs from the raw one.
    const ENCODABLE = 'dummy/value+eeee 0010';
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

    it('lists the raw, URL-encoded and base64 spellings, and base64(`user:value`) for basic auth', () => {
        const forms = credentialForms(ENCODABLE, USERNAME);
        expect(forms).toContain(ENCODABLE);
        expect(forms).toContain(encodeURIComponent(ENCODABLE));
        expect(forms).toContain(b64(ENCODABLE).replace(/=+$/, ''));
        expect(forms).toContain(b64(`${USERNAME}:${ENCODABLE}`).replace(/=+$/, ''));
        const echoed = `Authorization: Basic ${b64(`${USERNAME}:${ENCODABLE}`)} url ?key=${encodeURIComponent(ENCODABLE)}`;
        const scrubbed = withoutCredential(echoed, forms);
        for (const form of forms) expect(scrubbed.includes(form), form.length.toString()).toBe(false);
        expect(scrubbed).toContain('[credential withheld]');
        const thrown = withoutCredentialThrown(Object.assign(new Error('outer'), { cause: new Error(echoed) }), forms) as Error;
        expect(String(thrown.message)).toBe('outer');
        expect((thrown as { cause?: unknown }).cause).toBeUndefined();
        expect(upstreamRefusalMessage({ message: echoed }, forms)).not.toContain(encodeURIComponent(ENCODABLE));
    });

    it('a basic-auth instance whose upstream echoes the encoded header and URL: no spelling reaches the reason, the row or a log', async () => {
        const out = captureOutput();
        const header = b64(`${USERNAME}:${ENCODABLE}`);
        const provider = fakeProvider();
        const factory: ConnectorProviderFactory = (ctx) => {
            provider.state.materialized.push(ctx);
            const password = ctx.auth?.type === 'basic' ? ctx.auth.password : '';
            const echo = `sent Authorization: Basic ${b64(`${USERNAME}:${password}`)} to https://erp.example/?key=${encodeURIComponent(password)}`;
            if (provider.state.rejectAtMaterialization) throw new ConnectorCredentialRejectedError(`refused (HTTP 401): ${echo}`, 401);
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', actions: [{ key: 'request', label: 'Request' }] } as unknown as Connector,
                handlers: { request: async () => ({ status: 401, ok: false, body: { message: echo } }) },
            };
        };
        const erp = { ...billing('erp'), auth: { type: 'basic', username: USERNAME, credentialRef: REF } };
        const { engine, call } = await boot([erp], { provider: { ...provider, factory } });

        // On a call (the rest / openapi shape).
        await engine.setConnectorCredential({ ref: REF, value: ENCODABLE, context: ADMIN });
        expect(await call('erp')).toMatchObject({ status: 401 });
        const onCall = engine.getConnectorDegradedReason('erp') ?? '';
        expect(onCall).toContain('[credential withheld]');
        const listedOnCall = JSON.stringify(await engine.listConnectorCredentialRefs());

        // At materialization (the mcp shape).
        provider.state.rejectAtMaterialization = true;
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        const atMaterialization = engine.getConnectorDegradedReason('erp') ?? '';
        expect(atMaterialization).toContain('[credential withheld]');

        for (const [where, text] of [
            ['reason on a call', onCall],
            ['listing after the call', listedOnCall],
            ['reason at materialization', atMaterialization],
            ['listing after materialization', JSON.stringify(await engine.listConnectorCredentialRefs())],
            ['logs', out.text()],
        ] as const) {
            for (const form of [header, encodeURIComponent(ENCODABLE), ENCODABLE, b64(`${USERNAME}:${DUMMY_VALUE_2}`).replace(/=+$/, '')]) {
                expect(text.includes(form), `${where}: a spelling of the value`).toBe(false);
            }
        }
    });

    // [ADR-0015 D7] The connector path takes its spellings from the shared
    // `borrowedCredentialForms`, so the form encoding `URLSearchParams` writes
    // (a space as `+`, which `encodeURIComponent` spells `%20`) is withheld here
    // as it is for a datasource borrowing the same credential.
    it('an api-key instance whose upstream echoes the form-encoded query string: no spelling reaches the reason, the row or a log', async () => {
        const formEncoded = new URLSearchParams({ v: ENCODABLE }).toString().slice(2);
        expect(formEncoded).not.toBe(encodeURIComponent(ENCODABLE));
        expect(credentialForms(ENCODABLE)).toContain(formEncoded);

        const out = captureOutput();
        const provider = fakeProvider();
        const factory: ConnectorProviderFactory = (ctx) => {
            provider.state.materialized.push(ctx);
            const key = ctx.auth?.type === 'api-key' ? ctx.auth.key : '';
            const echo = `GET https://erp.example/orders?${new URLSearchParams({ api_key: key })} was refused`;
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', actions: [{ key: 'request', label: 'Request' }] } as unknown as Connector,
                handlers: { request: async () => ({ status: 401, ok: false, body: { message: echo } }) },
            };
        };
        const erp = { ...billing('erp'), auth: { type: 'api-key', paramName: 'api_key', credentialRef: REF } };
        const { engine, call } = await boot([erp], { provider: { ...provider, factory } });

        await engine.setConnectorCredential({ ref: REF, value: ENCODABLE, context: ADMIN });
        expect(await call('erp')).toMatchObject({ status: 401 });
        const reason = engine.getConnectorDegradedReason('erp') ?? '';
        expect(reason).toContain('[credential withheld]');

        for (const [where, text] of [
            ['reason on a call', reason],
            ['listing after the call', JSON.stringify(await engine.listConnectorCredentialRefs())],
            ['logs', out.text()],
        ] as const) {
            for (const form of [formEncoded, encodeURIComponent(ENCODABLE), ENCODABLE]) {
                expect(text.includes(form), `${where}: a spelling of the value`).toBe(false);
            }
        }
    });
});

/** [#28016] Run a one-node flow dispatching to `billing.request` and return its refusal text. */
async function dispatchRefusal(engine: AutomationEngine): Promise<string> {
    engine.registerFlow('call_billing', {
        name: 'call_billing',
        label: 'Call billing',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'connector_action', label: 'Request', connectorConfig: { connectorId: 'billing', actionId: 'request', input: {} } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    } as never);
    const result = await engine.execute('call_billing');
    expect(result.success).toBe(false);
    return String(result.error);
}

describe('[#28016] a dispatch to an instance held on a refused stored credential says to set it again', () => {
    it('refused at materialization (the mcp shape): set the credential again; nothing retries it', async () => {
        const { engine, provider } = await boot([billing()]);
        provider.state.rejectAtMaterialization = true;
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });

        const error = await dispatchRefusal(engine);
        expect(error).toContain("connector 'billing' is degraded — ");
        expect(error).toContain(`until credential '${REF}' is set again (or the server restarts); the platform does not retry it.`);
        expect(error).not.toMatch(/retries automatically/);
        expect(error).not.toContain('.. Dispatch');
        expect(error.includes(DUMMY_VALUE)).toBe(false);
    });

    it('refused on a call (the rest / openapi shape): set the credential again; nothing retries it', async () => {
        const { engine, provider, call } = await boot([billing()]);
        await engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        provider.state.callStatus = 401;
        await call();

        const error = await dispatchRefusal(engine);
        expect(error).toContain(`until credential '${REF}' is set again (or the server restarts); the platform does not retry it.`);
        expect(error).not.toMatch(/retries automatically/);
        expect(error).not.toContain('.. Dispatch');
    });

    it('control: an environment value refused on a call is on the backoff, and the refusal says the platform retries it', async () => {
        process.env[REF] = DUMMY_ENV_VALUE;
        envKeys.push(REF);
        const { engine, provider, call } = await boot([billing()]);
        provider.state.callStatus = 403;
        await call();

        const error = await dispatchRefusal(engine);
        expect(error).toContain('The instance is retried with backoff.');
        expect(error).toContain('Dispatch is unavailable until that is resolved; the platform retries automatically.');
        expect(error).not.toMatch(/does not retry/);
    });
});
