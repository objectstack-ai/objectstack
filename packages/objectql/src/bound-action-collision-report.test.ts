// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24472] A top-level action bound by `objectName` to an object that already
 * lists an action of the same name is not attached — the object keeps serving
 * its own declaration (the router's rung 1). When the two declarations DIFFER,
 * that pair is reported, never refused: one warning per pair, naming the
 * object, the action and both packages, at `kernel:ready` and for each artifact
 * that arrives later. A pair that is one declaration carried twice is not a
 * collision.
 *
 * The handler face of the same pair: the engine keys handlers by
 * `OBJECT:ACTION`, so the second package's `registerAction` replaces the
 * first's. It still does — the last registration runs — but it is warned,
 * naming both owners; the same owner re-registering is not.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

/** The package that OWNS the target object, with an action of its own. */
const OWNER = {
    id: 'com.test.owner', name: 'owner',
    objects: [{
        name: 'bc_org', label: 'Org',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        actions: [{ name: 'rename', label: 'Rename', type: 'url', target: 'https://example.com/own', locations: ['record_header'] }],
    }],
};

/** Another package binding an action of the same NAME to the owner's object — a different declaration. */
const TWIN = {
    id: 'com.test.twin', name: 'twin',
    actions: [{ name: 'rename', label: 'Rename (twin)', objectName: 'bc_org', type: 'url', target: 'https://example.com/twin', locations: ['record_header'] }],
};

/** Another package carrying the owner's declaration itself, bound by `objectName` — one declaration, two packages. */
const CARRIER = {
    id: 'com.test.carrier', name: 'carrier',
    actions: [{ ...OWNER.objects[0].actions[0], objectName: 'bc_org' }],
};

/** A package that brings an unrelated object — the late-artifact control. */
const BYSTANDER = {
    id: 'com.test.bystander', name: 'bystander',
    objects: [{ name: 'bc_other', label: 'Other', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
};

async function engineWith(packages: any[]) {
    const engine = new ObjectQL();
    await engine.init();
    for (const pkg of packages) engine.registerApp(structuredClone(pkg));
    return engine;
}

const servedRename = (engine: ObjectQL): any[] =>
    ((engine.registry.getObject('bc_org') as any)?.actions ?? []).filter((a: any) => a?.name === 'rename');

describe('SchemaRegistry.findBoundActionCollisions', () => {
    for (const [order, packages] of [
        ['owner first', [OWNER, TWIN]],
        ['twin first', [TWIN, OWNER]],
    ] as const) {
        it(`${order}: a different declaration under the object's own action name is one pair, naming both packages`, async () => {
            const engine = await engineWith([...packages]);
            expect(engine.registry.findBoundActionCollisions()).toEqual([
                { objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.owner', shadowedPackageId: 'com.test.twin' },
            ]);
            // Reported, not acted on: the object still serves its own declaration.
            expect(servedRename(engine).map((a) => a.target)).toEqual(['https://example.com/own']);
        });
    }

    it('one declaration carried by two packages is not a collision', async () => {
        const engine = await engineWith([OWNER, CARRIER]);
        expect(engine.registry.findBoundActionCollisions()).toEqual([]);
    });

    it('a same-stack bound action — merged onto its object and kept top-level — is not a collision', async () => {
        const stack = defineStack({
            manifest: { id: 'com.test.same', name: 'same', version: '1.0.0', type: 'app' },
            objects: [{ name: 'bc_same', label: 'Same', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
            actions: [{ name: 'same_action', label: 'Same', objectName: 'bc_same', type: 'url', target: 'https://example.com', locations: ['record_header'] }],
        } as any);
        // The JSON round trip is the compiled artifact's shape: two copies, not one reference.
        const engine = await engineWith([JSON.parse(JSON.stringify({ ...stack, ...stack.manifest }))]);
        expect((engine.registry.getObject('bc_same') as any)?.actions?.map((a: any) => a.name)).toEqual(['same_action']);
        expect(engine.registry.findBoundActionCollisions()).toEqual([]);
    });

    it('two packages binding different declarations of one name to a third package\'s object: the first attached is served, the second reported', async () => {
        const owner = { ...OWNER, objects: [{ ...OWNER.objects[0], actions: [] }] };
        const second = { ...TWIN, id: 'com.test.second', name: 'second', actions: [{ ...TWIN.actions[0], label: 'Rename (second)', target: 'https://example.com/second' }] };
        const engine = await engineWith([owner, TWIN, second]);
        expect(servedRename(engine).map((a) => a._packageId)).toEqual(['com.test.twin']);
        expect(engine.registry.findBoundActionCollisions()).toEqual([
            { objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.twin', shadowedPackageId: 'com.test.second' },
        ]);
    });

    it('narrowed to a set of packages, it answers only the pairs naming one of them', async () => {
        const engine = await engineWith([OWNER, TWIN, BYSTANDER]);
        expect(engine.registry.findBoundActionCollisions(new Set(['com.test.bystander']))).toEqual([]);
        expect(engine.registry.findBoundActionCollisions(new Set(['com.test.owner']))).toHaveLength(1);
        expect(engine.registry.findBoundActionCollisions(new Set(['com.test.twin']))).toHaveLength(1);
    });
});

// ── The report: at kernel:ready, and for each later artifact ───────────────

interface ManifestService {
    register(artifact: unknown): Promise<void> | void;
}

const kernels: ObjectKernel[] = [];
afterEach(async () => {
    while (kernels.length) {
        const kernel = kernels.pop()!;
        try { if (kernel.getState() === 'running') await kernel.shutdown(); } catch { /* noop */ }
    }
});

function registering(name: string, artifacts: unknown[]) {
    return {
        name,
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            const manifest = ctx.getService<ManifestService>('manifest');
            for (const artifact of artifacts) await manifest.register(structuredClone(artifact));
        },
    };
}

/** A kernel whose logger's `warn` is spied: the plugin's `ctx.logger` is the kernel's own. */
function kernelWith(...plugins: any[]) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    const warn = vi.spyOn((kernel as any).logger, 'warn');
    const collisionWarnings = () => warn.mock.calls.filter(([, meta]: any[]) => meta && 'shadowedPackageId' in meta);
    return { kernel, collisionWarnings, use: async () => { for (const p of plugins) await kernel.use(p); } };
}

describe('the bound-action collision report', () => {
    it('warns once at kernel:ready, naming the object, the action and both packages — and the boot goes on', async () => {
        const { kernel, collisionWarnings, use } = kernelWith(new ObjectQLPlugin(), registering('owner', [OWNER]), registering('twin', [TWIN]));
        await use();
        await kernel.bootstrap();
        const warned = collisionWarnings();
        expect(warned).toHaveLength(1);
        const [message, meta] = warned[0] as [string, any];
        expect(meta).toEqual({ objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.owner', shadowedPackageId: 'com.test.twin' });
        for (const subject of ["'rename'", "'bc_org'", "'com.test.owner'", "'com.test.twin'"]) expect(message).toContain(subject);
        expect(servedRename(kernel.getService<ObjectQL>('objectql')).map((a) => a.target)).toEqual(['https://example.com/own']);
    });

    it('control: one declaration carried by two packages boots with no warning', async () => {
        const { kernel, collisionWarnings, use } = kernelWith(new ObjectQLPlugin(), registering('owner', [OWNER]), registering('carrier', [CARRIER]));
        await use();
        await kernel.bootstrap();
        expect(collisionWarnings()).toEqual([]);
    });

    it('an artifact arriving after the boot is judged once it registers, and nothing of it is refused', async () => {
        const { kernel, collisionWarnings, use } = kernelWith(new ObjectQLPlugin(), registering('owner', [OWNER]));
        await use();
        await kernel.bootstrap();
        expect(collisionWarnings()).toEqual([]);
        await kernel.getService<ManifestService>('manifest').register(structuredClone(TWIN));
        expect(collisionWarnings().map(([, meta]) => meta)).toEqual([
            { objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.owner', shadowedPackageId: 'com.test.twin' },
        ]);
        expect(kernel.getService<ObjectQL>('objectql').registry.getItem('action', 'rename')).toBeDefined();
    });

    it('a pair the boot reported is not reported again for an unrelated late artifact', async () => {
        const { kernel, collisionWarnings, use } = kernelWith(new ObjectQLPlugin(), registering('owner', [OWNER]), registering('twin', [TWIN]));
        await use();
        await kernel.bootstrap();
        await kernel.getService<ManifestService>('manifest').register(structuredClone(BYSTANDER));
        expect(collisionWarnings()).toHaveLength(1);
    });
});

// ── The handler face: registerAction's OBJECT:ACTION key ────────────────────

describe('ObjectQL.registerAction on a key another owner holds', () => {
    async function engineSpied() {
        const engine = new ObjectQL();
        const warn = vi.spyOn((engine as any).logger, 'warn');
        const replacements = () => warn.mock.calls.filter(([, meta]: any[]) => meta && 'replacedPackage' in meta);
        return { engine, replacements };
    }

    it('replaces the handler — the last registration runs — and warns naming both owners', async () => {
        const { engine, replacements } = await engineSpied();
        engine.registerAction('bc_org', 'rename', () => 'owner', 'app:com.test.owner');
        engine.registerAction('bc_org', 'rename', () => 'twin', 'app:com.test.twin');
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe('twin');
        expect(replacements()).toHaveLength(1);
        const [message, meta] = replacements()[0] as [string, any];
        expect(meta).toEqual({ objectName: 'bc_org', actionName: 'rename', package: 'app:com.test.twin', replacedPackage: 'app:com.test.owner' });
        for (const subject of ["'bc_org:rename'", "'app:com.test.owner'", "'app:com.test.twin'"]) expect(message).toContain(subject);
    });

    it('withdrawing the replacing owner leaves the key with no handler — the consequence the warning names', async () => {
        const { engine } = await engineSpied();
        engine.registerAction('bc_org', 'rename', () => 'owner', 'app:com.test.owner');
        engine.registerAction('bc_org', 'rename', () => 'twin', 'app:com.test.twin');
        engine.removeActionsByPackage('app:com.test.twin');
        await expect(engine.executeAction('bc_org', 'rename', {})).rejects.toThrow(/not found/);
    });

    it('a registration with no package and a package\'s are two owners', async () => {
        const { engine, replacements } = await engineSpied();
        engine.registerAction('bc_org', 'rename', () => 'owner', 'app:com.test.owner');
        engine.registerAction('bc_org', 'rename', () => 'imperative');
        expect(replacements().map(([, meta]) => (meta as any).replacedPackage)).toEqual(['app:com.test.owner']);
    });

    it('the same owner re-registering, and the tear-down-then-register resync, are silent', async () => {
        const { engine, replacements } = await engineSpied();
        engine.registerAction('bc_org', 'rename', () => 1, 'app:com.test.owner');
        engine.registerAction('bc_org', 'rename', () => 2, 'app:com.test.owner');
        engine.registerAction('bc_org', 'unowned', () => 1);
        engine.registerAction('bc_org', 'unowned', () => 2);
        engine.registerAction('bc_org', 'authored', () => 1, 'metadata-service');
        engine.removeActionsByPackage('metadata-service');
        engine.registerAction('bc_org', 'authored', () => 2, 'metadata-service');
        expect(replacements()).toEqual([]);
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe(2);
    });
});
