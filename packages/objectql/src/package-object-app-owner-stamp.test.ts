// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] A package body's OBJECTS and APPS — the two collections it files
 * through verbs of their own (`registerObject`, `registerApp`) rather than the
 * collection loop — are refused a body `_packageId` other than the package they
 * register under, by the one judge the loop calls
 * (`collectionItemOwnerStampRefusal` → `judgeCollectionItemOwnerStamp`), and
 * BEFORE anything of the body registers.
 *
 * ## The defect, read before the fix
 *
 * `stampPackage` and `registerItem` stamp through `applyProtection`, which
 * writes `_packageId` only while it is unset. An installed body whose `apps[0]`
 * carried the host's id registered an app filed under the host: the
 * per-package list filter and the disabled-package filter read that stamp. An
 * object's stamp was kept on the definition and read by `registerObject`'s
 * action-parse predicate (`schema._packageId ?? packageId`).
 *
 * ## What this file pins
 *
 *  - an app (`apps[]`, the manifest-as-app, a nested plugin-as-app) and an
 *    object (array and map form, a nested plugin's) wearing another package's
 *    id: `VALIDATION_ERROR` / 400 at `_packageId` in the judge's words, and no
 *    package record, object or app left behind;
 *  - CONTROLS: an absent stamp and a stamp equal to the package register as
 *    before, and one app object re-registered (the in-place stamp a first
 *    registration leaves) is accepted under its own package and under another;
 *  - the residual door refuses a residual object's stamp in the same envelope.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { judgeCollectionItemOwnerStamp } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

const PKG = 'com.probe.pkg';
const HOST = 'com.probe.host';

const object = (stamp?: unknown, name = 'probe_thing') => ({
    name,
    label: 'Probe thing',
    fields: { title: { type: 'text', label: 'Title' } },
    ...(stamp === undefined ? {} : { _packageId: stamp }),
});
const app = (stamp?: unknown, name = 'probe_app') => ({
    name,
    label: 'Probe app',
    navigation: [{ id: 'nav_thing', type: 'object', label: 'Things', objectName: 'probe_thing' }],
    ...(stamp === undefined ? {} : { _packageId: stamp }),
});

/** Register once on a fresh engine; hand back what was thrown and what the registry holds. */
function register(manifest: Record<string, unknown>) {
    const engine = new ObjectQL();
    let error: any;
    try {
        engine.registerApp(manifest as any);
    } catch (e) {
        error = e;
    }
    return {
        error,
        pkg: engine.registry.getPackage(String(manifest.id)),
        objects: engine.registry.getAllObjects().map((o: any) => o.name),
        apps: engine.registry.listItems('app').map((a: any) => ({ name: a.name, _packageId: a._packageId })),
    };
}

function expectRefused(r: ReturnType<typeof register>, type: string, name: string) {
    expect(r.error, 'the registration must be refused').toBeInstanceOf(Error);
    expect(r.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
    expect(r.error.issues).toEqual([{ path: '_packageId', code: 'custom', message: expect.any(String) }]);
    const judged = judgeCollectionItemOwnerStamp({ _packageId: HOST }, type, name, PKG, 'register')!;
    expect(r.error.message, 'the one judge\'s words').toBe(judged.message);
    expect(r.pkg, 'refused before the package record is written').toBeUndefined();
    expect(r.objects).not.toContain('probe_thing');
    expect(r.apps).toEqual([]);
}

describe('[#28697] registerApp refuses an app or object whose body `_packageId` is not its package, before anything registers', () => {
    it('an `apps[]` entry naming another package', () => {
        expectRefused(register({ id: PKG, name: 'probe', objects: [object()], apps: [app(HOST)] }), 'app', 'probe_app');
    });

    it('the manifest registered as its own app', () => {
        const r = register({ id: PKG, name: 'probe', navigation: app().navigation, objects: [object()], _packageId: HOST });
        expectRefused(r, 'app', 'probe');
    });

    it('an `objects[]` entry naming another package — array form and name-keyed map form', () => {
        expectRefused(register({ id: PKG, name: 'probe', objects: [object(HOST)], apps: [app()] }), 'object', 'probe_thing');
        const { name: _n, ...unnamed } = object(HOST);
        expectRefused(register({ id: PKG, name: 'probe', objects: { probe_thing: unnamed }, apps: [app()] }), 'object', 'probe_thing');
    });

    it('a nested plugin\'s object and plugin-as-app, judged against the parent package', () => {
        const r1 = register({ id: PKG, name: 'probe', plugins: [{ name: 'nested', objects: [object(HOST)] }] });
        expect(r1.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(r1.error.message).toContain("from object 'probe_thing'");
        expect(r1.objects).not.toContain('probe_thing');
        const r2 = register({ id: PKG, name: 'probe', plugins: [{ ...app(HOST, 'nested_app') }] });
        expect(r2.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(r2.error.message).toContain("from app 'nested_app'");
        expect(r2.apps).toEqual([]);
    });

    it('`null` and the empty string are stamps too', () => {
        for (const stamp of [null, '']) {
            const r = register({ id: PKG, name: 'probe', apps: [app(stamp)] });
            expect(r.error, `stamp ${JSON.stringify(stamp)}`).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            expect(r.apps).toEqual([]);
        }
    });

    it('CONTROL: an absent stamp and a stamp equal to the package register as before', () => {
        for (const stamp of [undefined, PKG]) {
            const r = register({ id: PKG, name: 'probe', objects: [object(stamp)], apps: [app(stamp)] });
            expect(r.error, `stamp ${String(stamp)}`).toBeUndefined();
            expect(r.objects).toContain('probe_thing');
            expect(r.apps).toEqual([{ name: 'probe_app', _packageId: PKG }]);
        }
    });

    it('CONTROL: one app object, stamped in place by a first registration, registers again under its own package and under another', () => {
        const shared = app();
        new ObjectQL().registerApp({ id: HOST, name: 'host', apps: [shared] } as any);
        expect((shared as { _packageId?: unknown })._packageId, 'the first registration stamped the caller\'s app').toBe(HOST);
        expect(register({ id: HOST, name: 'host', apps: [shared] }).error).toBeUndefined();
        // A module constant handed on: no body wrote that stamp.
        expect(register({ id: PKG, name: 'probe', apps: [shared] }).error).toBeUndefined();
        // The same bytes ARRIVING as a body are the body's own stamp.
        const arrived = register({ id: PKG, name: 'probe', apps: [JSON.parse(JSON.stringify(shared))] });
        expect(arrived.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });
});

// ── the residual door ──────────────────────────────────────────────────────

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

async function bootRegistering(artifact: unknown): Promise<{ ql: ObjectQL; error: any }> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    let error: any;
    await kernel.use({
        name: 'test.object-app-owner-stamp.registrar',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            try {
                await ctx.getService<ManifestService>('manifest').register(artifact);
            } catch (e) {
                error = e;
            }
        },
    } as Plugin);
    await kernel.bootstrap();
    return { ql: kernel.getService<ObjectQL>('objectql'), error };
}

describe('[#28697] the residual door refuses a residual object\'s and app\'s stamp in the body seam\'s envelope', () => {
    const withResidual = (extra: Record<string, unknown>) => ({
        manifest: { ...body(STACK, 'probestack') },
        ...body(STACK, 'probestack'),
        packages: [{ manifest: body('com.probe.a', 'probea') }, { manifest: body('com.probe.b', 'probeb') }],
        ...extra,
    });

    it('a residual object wearing another package\'s id: refused, not served', async () => {
        const { ql, error } = await bootRegistering(withResidual({ objects: [object('com.probe.a')] }));
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([expect.objectContaining({ path: '_packageId' })]);
        expect(error.message).toContain("from object 'probe_thing'");
        expect(error.message).toContain(`under package '${STACK}'`);
        expect(ql.registry.getObject('probe_thing')).toBeUndefined();
    });

    it('a residual app wearing another package\'s id: refused, not filed', async () => {
        const { ql, error } = await bootRegistering(withResidual({ apps: [app('com.probe.a')] }));
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(error.message).toContain("from app 'probe_app'");
        expect(ql.registry.listItems('app').find((a: any) => a?.name === 'probe_app')).toBeUndefined();
    });

    it('CONTROL: an unstamped residual object and app register under the residual\'s id', async () => {
        const { ql, error } = await bootRegistering(withResidual({ objects: [object()], apps: [app()] }));
        expect(error).toBeUndefined();
        expect(ql.registry.getObjectOwner?.('probe_thing')?.packageId ?? (ql.registry.getObject('probe_thing') as any)?._packageId).toBe(STACK);
        expect(ql.registry.listItems('app').find((a: any) => a?.name === 'probe_app')).toMatchObject({ _packageId: STACK });
    });
});
