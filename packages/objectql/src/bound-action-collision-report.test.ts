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
import { ObjectSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { FIND_BOUND_ACTION_COLLISIONS, SchemaRegistry } from './registry.js';

/**
 * The package that OWNS the target object, with an action of its own — authored
 * as an object is (`ObjectSchema.create`), so its action is the parse of what
 * was written, as a bound action's registered copy is (#25649).
 */
const OWNER = {
    id: 'com.test.owner', name: 'owner',
    objects: [ObjectSchema.create({
        name: 'bc_org', label: 'Org',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        actions: [{ name: 'rename', label: 'Rename', type: 'url', target: 'https://example.com/own', locations: ['record_header'] }],
    } as any)],
};

/** Another package binding an action of the same NAME to the owner's object — a different declaration. */
const TWIN = {
    id: 'com.test.twin', name: 'twin',
    actions: [{ name: 'rename', label: 'Rename (twin)', objectName: 'bc_org', type: 'url', target: 'https://example.com/twin', locations: ['record_header'] }],
};

/** Another package carrying the owner's declaration itself, bound by `objectName` — one declaration, two packages. */
const CARRIER = {
    id: 'com.test.carrier', name: 'carrier',
    actions: [{ ...OWNER.objects[0].actions![0], objectName: 'bc_org' }],
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

describe('the registry\'s bound-action collision audit', () => {
    for (const [order, packages] of [
        ['owner first', [OWNER, TWIN]],
        ['twin first', [TWIN, OWNER]],
    ] as const) {
        it(`${order}: a different declaration under the object's own action name is one pair, naming both packages`, async () => {
            const engine = await engineWith([...packages]);
            expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS]()).toEqual([
                { objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.owner', shadowedPackageId: 'com.test.twin' },
            ]);
            // Reported, not acted on: the object still serves its own declaration.
            expect(servedRename(engine).map((a) => a.target)).toEqual(['https://example.com/own']);
        });
    }

    it('one declaration carried by two packages is not a collision', async () => {
        const engine = await engineWith([OWNER, CARRIER]);
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS]()).toEqual([]);
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
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS]()).toEqual([]);
    });

    it('two packages binding different declarations of one name to a third package\'s object: the first attached is served, the second reported', async () => {
        const owner = { ...OWNER, objects: [{ ...OWNER.objects[0], actions: [] }] };
        const second = { ...TWIN, id: 'com.test.second', name: 'second', actions: [{ ...TWIN.actions[0], label: 'Rename (second)', target: 'https://example.com/second' }] };
        const engine = await engineWith([owner, TWIN, second]);
        expect(servedRename(engine).map((a) => a._packageId)).toEqual(['com.test.twin']);
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS]()).toEqual([
            { objectName: 'bc_org', action: 'rename', servedPackageId: 'com.test.twin', shadowedPackageId: 'com.test.second' },
        ]);
    });

    it('is no nameable member of the published face: keyed on a symbol neither package entry exports', async () => {
        const entry = await import('./index.js');
        const core = await import('./core.js');
        expect('FIND_BOUND_ACTION_COLLISIONS' in entry).toBe(false);
        expect('FIND_BOUND_ACTION_COLLISIONS' in core).toBe(false);
        expect(Object.values(entry)).not.toContain(FIND_BOUND_ACTION_COLLISIONS);
        expect(Object.getOwnPropertyNames(SchemaRegistry.prototype)).not.toContain('findBoundActionCollisions');
        expect(Object.getOwnPropertySymbols(SchemaRegistry.prototype)).toContain(FIND_BOUND_ACTION_COLLISIONS);
    });

    it('narrowed to a set of packages, it answers only the pairs naming one of them', async () => {
        const engine = await engineWith([OWNER, TWIN, BYSTANDER]);
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS](new Set(['com.test.bystander']))).toEqual([]);
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS](new Set(['com.test.owner']))).toHaveLength(1);
        expect(engine.registry[FIND_BOUND_ACTION_COLLISIONS](new Set(['com.test.twin']))).toHaveLength(1);
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

/**
 * [ADR-0150 D4, #31673] The handler half of the action's
 * `(package, objectName, name)` key: each package's handler under one object
 * and name is kept, and a call that names its package runs its own.
 */
describe('ObjectQL action handlers keyed (package, objectName, name)', () => {
    const OWNER = 'com.test.owner';
    const TWIN = 'com.test.twin';

    it('two packages\' handlers for one object and name coexist: a call naming each package runs its own', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'owner', `app:${OWNER}`);
        engine.registerAction('bc_org', 'rename', () => 'twin', `app:${TWIN}`);
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('owner');
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: TWIN })).toBe('twin');
    });

    it('[#31697 interim] a call that names no package keeps today\'s answer exactly: the last registration runs', async () => {
        // Ruling 6728550494 (epic #31527, option B): whether this call refuses
        // when two packages hold one object and name is #31697's decision.
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'owner', `app:${OWNER}`);
        engine.registerAction('bc_org', 'rename', () => 'twin', `app:${TWIN}`);
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe('twin');
        engine.registerAction('bc_org', 'rename', () => 'owner again', `app:${OWNER}`);
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe('owner again');
    });

    it('withdrawing one package keeps the other\'s handler for a call naming it', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'owner', `app:${OWNER}`);
        engine.registerAction('bc_org', 'rename', () => 'twin', `app:${TWIN}`);
        engine.removeActionsByPackage(`app:${TWIN}`);
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('owner');
        await expect(engine.executeAction('bc_org', 'rename', {}, { packageId: TWIN })).rejects.toThrow(/not found/);
    });

    it('a call naming a package with no handler of its own runs the ONE plugin-registered handler under the key', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'plugin', 'com.test.plugin');
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('plugin');
    });

    it('never runs another package\'s handler', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'owner', `app:${OWNER}`);
        await expect(engine.executeAction('bc_org', 'rename', {}, { packageId: 'com.test.third' })).rejects.toThrow(/not found/);
    });

    it('never runs the environment\'s handler for another holder\'s declaration — authored resync or owner-less', async () => {
        // B's declaration resolved, B registered no handler, and the
        // environment's own same-key action has one: that is not B's code.
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'environment', 'metadata-service');
        await expect(engine.executeAction('bc_org', 'rename', {}, { packageId: TWIN })).rejects.toThrow(/not found/);
        engine.registerAction('bc_org', 'rename', () => 'owner-less');
        await expect(engine.executeAction('bc_org', 'rename', {}, { packageId: TWIN })).rejects.toThrow(/not found/);
        // Control: the no-package call still runs the environment's slot, as before.
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe('owner-less');
    });

    it('refuses 409 RESOURCE_CONFLICT naming every owner when two plugins hold the key — never "not found", never a pick', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'one', 'com.test.plugin-one');
        engine.registerAction('bc_org', 'rename', () => 'two', 'com.test.plugin-two');
        const refusal = await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER }).then(() => undefined, (err: any) => err);
        expect(refusal).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, owners: ['com.test.plugin-one', 'com.test.plugin-two'] });
        for (const owner of ['com.test.plugin-one', 'com.test.plugin-two', OWNER]) expect(refusal.message).toContain(owner);
        expect(refusal.message).not.toMatch(/not found/);
        // A package's own handler still answers for it.
        engine.registerAction('bc_org', 'rename', () => 'owner', `app:${OWNER}`);
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('owner');
    });

    it('handlers on two objects under one name are two keys for every caller', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'org', `app:${OWNER}`);
        engine.registerAction('bc_person', 'rename', () => 'person', `app:${TWIN}`);
        expect(await engine.executeAction('bc_org', 'rename', {})).toBe('org');
        expect(await engine.executeAction('bc_person', 'rename', {})).toBe('person');
        expect(await engine.executeAction('bc_person', 'rename', {}, { packageId: TWIN })).toBe('person');
    });

    it('a declared override binds over its base package\'s handler; withdrawing it restores the base\'s', async () => {
        const engine = new ObjectQL();
        engine.registerAction('bc_org', 'rename', () => 'base', `app:${OWNER}`);
        engine.registerAction('bc_org', 'rename', () => 'twin', `app:${TWIN}`);
        engine.registerActionOverride('bc_org', 'rename', () => 'override', 'app:com.test.custom', OWNER);
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('override');
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: TWIN })).toBe('twin');
        engine.removeActionsByPackage('app:com.test.custom');
        expect(await engine.executeAction('bc_org', 'rename', {}, { packageId: OWNER })).toBe('base');
    });
});
