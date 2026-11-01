// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28534] A collection item's `_packageId` is the REGISTRATION's word, never
 * the body's: `registerApp` (the manifest seam and a nested plugin, through the
 * one `registerMetadataCollections`) and the `manifest` service's residual
 * registration refuse an item whose body already wears a `_packageId` other
 * than the package they register it under — and the `manifest` service records
 * which door registered each artifact residual's owner.
 *
 * ## The defect, read before the fix
 *
 * `stampPackage` and `registerItem` stamp through `applyProtection`, which
 * writes `_packageId` only while it is `undefined`, and `ConnectorBaseSchema`
 * (like every item schema spreading `MetadataProtectionFields`) declares the
 * key. So a connector entry of package `com.probe.pkg` carrying
 * `_packageId: 'com.probe.host'` registered with that stamp, and the connector
 * materializer, asking whose root a file ref resolves against, read the host's.
 *
 * ## What this file pins
 *
 *  - the refusal's envelope (`VALIDATION_ERROR` / 400, `issues[]` at
 *    `_packageId`, the permission-set owner refusal's envelope at the same
 *    seam) and that nothing is filed — for a foreign id, `null` and `''`, on
 *    the manifest seam, a nested plugin and seed datasets;
 *  - CONTROLS: an absent stamp and a stamp equal to the owner register under
 *    the package, and one item object re-registered under its own package
 *    (the in-place stamp a first registration leaves) is accepted;
 *  - the residual door refuses the same stamp in the same words, and records
 *    the residual owner's origin as the door states it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

const PKG = 'com.probe.pkg';
const HOST = 'com.probe.host';

const connector = (stamp?: unknown) => ({
    name: 'probe_conn',
    label: 'Probe',
    type: 'api',
    provider: 'openapi',
    providerConfig: { spec: './specs/billing.json' },
    ...(stamp === undefined ? {} : { _packageId: stamp }),
});

/** Register once; hand back what was thrown (if anything) and what was filed. */
function register(manifest: Record<string, unknown>, type = 'connector', name = 'probe_conn'): { error: any; filed: any } {
    const engine = new ObjectQL();
    let error: any;
    try {
        engine.registerApp(manifest as any);
    } catch (e) {
        error = e;
    }
    const filed = engine.registry.listItems(type).find((i: any) => (i?.name ?? i?.object) === name);
    return { error, filed };
}

describe('[#28534] registerApp refuses a collection item whose body `_packageId` is not its package', () => {
    it('a connector naming another package: VALIDATION_ERROR / 400 at `_packageId`, and nothing filed', () => {
        const { error, filed } = register({ id: PKG, name: 'probe', connectors: [connector(HOST)] });
        expect(error, 'the registration must be refused').toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([expect.objectContaining({ path: '_packageId', code: 'custom' })]);
        expect(error.message.indexOf("Drop `_packageId` from connector 'probe_conn'")).toBe(0);
        expect(error.message).toContain(`"${HOST}"`);
        expect(error.message).toContain(`under package '${PKG}'`);
        expect(filed, 'refused before the item is filed').toBeUndefined();
    });

    it('`null` and the empty string are stamps too — neither is overwritten, so both are refused', () => {
        for (const stamp of [null, '']) {
            const { error, filed } = register({ id: PKG, name: 'probe', connectors: [connector(stamp)] });
            expect(error, `stamp ${JSON.stringify(stamp)}`).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            expect(filed).toBeUndefined();
        }
    });

    it('a nested plugin\'s item is judged against the parent package it registers under', () => {
        const { error, filed } = register({ id: PKG, name: 'probe', plugins: [{ name: 'nested', connectors: [connector(HOST)] }] });
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(filed).toBeUndefined();
    });

    it('a seed dataset, filed outside the collection loop, is judged the same way', () => {
        const { error, filed } = register(
            { id: PKG, name: 'probe', data: [{ object: 'probe_obj', records: [], _packageId: HOST }] },
            'data',
            'probe_obj',
        );
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(error.message).toContain("from data 'probe_obj'");
        expect(filed).toBeUndefined();
    });

    it('CONTROL: an absent stamp and a stamp equal to the package register under the package', () => {
        for (const stamp of [undefined, PKG]) {
            const { error, filed } = register({ id: PKG, name: 'probe', connectors: [connector(stamp)] });
            expect(error, `stamp ${String(stamp)}`).toBeUndefined();
            expect(filed).toMatchObject({ name: 'probe_conn', _packageId: PKG });
        }
    });

    it('CONTROL: one manifest object registered twice under its own id is accepted (the first pass stamps it in place)', () => {
        const engine = new ObjectQL();
        const manifest = { id: PKG, name: 'probe', version: '1.0.0', connectors: [connector()] };
        engine.registerApp(manifest as any);
        expect((manifest.connectors[0] as any)._packageId, 'the first registration stamps the caller\'s item').toBe(PKG);
        expect(() => engine.registerApp(manifest as any)).not.toThrow();
        expect(engine.registry.listItems('connector')).toEqual([expect.objectContaining({ name: 'probe_conn', _packageId: PKG })]);
    });
});

// ── the residual door and its owner record ─────────────────────────────────

type ManifestService = { register(m: unknown, options?: { source?: 'code' | 'marketplace' }): void | Promise<void> };

const kernels: ObjectKernel[] = [];
afterEach(async () => {
    while (kernels.length) {
        const kernel = kernels.pop()!;
        if (kernel.getState() === 'running') await kernel.shutdown();
    }
});

const STACK = 'com.probe.stack';
const body = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'app' });
/** A two-body artifact whose top-level connector no body declares: the residual, owned by `STACK`. */
const withResidual = (residualConnector: Record<string, unknown>) => ({
    manifest: { ...body(STACK, 'probestack') },
    ...body(STACK, 'probestack'),
    packages: [{ manifest: body('com.probe.a', 'probea') }, { manifest: body('com.probe.b', 'probeb') }],
    connectors: [residualConnector],
});

/** Boot a kernel whose one plugin registers `artifact` through the `manifest` service in `init()`; answer what it threw. */
async function bootRegistering(
    artifact: unknown,
    options?: { source?: 'code' | 'marketplace' },
): Promise<{ ql: ObjectQL; error: any }> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    let error: any;
    await kernel.use({
        name: 'test.owner-stamp.registrar',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            try {
                await ctx.getService<ManifestService>('manifest').register(artifact, options);
            } catch (e) {
                error = e;
            }
        },
    } as Plugin);
    await kernel.bootstrap();
    return { ql: kernel.getService<ObjectQL>('objectql'), error };
}

describe('[#28534] the residual door: the same refusal, and the owner\'s origin recorded', () => {
    it('a residual connector wearing another package\'s id is refused in the body seam\'s envelope, and not filed', async () => {
        const { ql, error } = await bootRegistering(withResidual(connector(HOST)));
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([expect.objectContaining({ path: '_packageId' })]);
        expect(error.message).toContain(`under package '${STACK}'`);
        expect(ql.registry.listItems('connector').find((i: any) => i?.name === 'probe_conn')).toBeUndefined();
    });

    it('the boot door (no source stated) records the residual owner as `code`; an install records `marketplace`', async () => {
        const boot = await bootRegistering(withResidual(connector()));
        expect(boot.error).toBeUndefined();
        expect(boot.ql.residualOwnerSource(STACK)).toBe('code');
        expect(boot.ql.registry.getPackage(STACK), 'the residual is not a package: no row').toBeUndefined();
        expect(boot.ql.registry.listItems('connector')).toEqual([expect.objectContaining({ name: 'probe_conn', _packageId: STACK })]);

        const install = await bootRegistering(withResidual(connector()), { source: 'marketplace' });
        expect(install.error).toBeUndefined();
        expect(install.ql.residualOwnerSource(STACK)).toBe('marketplace');
    });

    it('CONTROL: an artifact with no residual records no owner, and a recorded `marketplace` is never turned into `code`', () => {
        const ql = new ObjectQL();
        expect(ql.residualOwnerSource(STACK)).toBeUndefined();
        ql.recordResidualOwner(STACK, 'marketplace');
        ql.recordResidualOwner(STACK, 'code');
        expect(ql.residualOwnerSource(STACK)).toBe('marketplace');
    });
});
