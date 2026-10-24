// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24400] A top-level action bound by `objectName` to an object ANOTHER package
 * owns reaches that object as it is served — `GET /api/v1/meta/object/<target>`'s
 * `actions` (the protocol's by-name read) and the registry's own resolved
 * object — whichever of the two packages registers first. A bound action whose
 * target no loaded package registers fails the boot instead of being listed
 * nowhere.
 *
 * This is the route `ObjectExtensionSchema`'s `guidance.actions` names, since
 * an object extension cannot carry `actions`. Before this, `defineStack()`
 * merged a bound action only into an object of the SAME stack, and the action
 * for another package's object registered as a standalone item that no served
 * object listed (measured on a booted showcase: present at
 * `GET /meta/action/<name>`, absent from `GET /meta/object/sys_organization`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { describeUnboundActionTargets } from './registry.js';
// [#21516] The rest of the stored-metadata family the repository writes through: the
// engine refuses a name the registry does not resolve, so the harness registers it as a boot does.
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] The real `sys_metadata` carries this — it is part of the
        // row's uniqueness key `(type, name, organization_id, package_id)` and
        // `SysMetadataRepository` writes it — but this minimal stub had omitted
        // it. Nothing noticed while an undeclared write key simply travelled to
        // the driver; the declared-field door judges the payload against this
        // map, so the omission now shows up as the fixture defect it always was.
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * Minimal stub driver covering only what `SysMetadataRepository`
 * exercises. Equality-only WHERE evaluation; one record store per object.
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;

    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them. The short-circuiting shape this stub used to carry
    // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
    // the same object, so a query like
    // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
    // was silently answered on the `$or` alone — a different query than the one
    // written, with the suite still green. See #7620.
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any))
                ? (v as any).$eq
                : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };

    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) {
            return storeFor(object).delete(id);
        },
        async count(object: string, ast: any) {
            return (await this.find(object, ast)).length;
        },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}



/** The package that OWNS the target object — it knows nothing of the action. */
const OWNER = {
    id: 'com.test.owner', name: 'owner',
    objects: [{
        name: 'ba_org', label: 'Org',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        actions: [{ name: 'own_action', label: 'Own', type: 'url', target: 'https://example.com/own', locations: ['record_header'] }],
    }],
};

/** The bound action another package declares for the owner's object. */
const BOUND = {
    name: 'rename_org', label: 'Rename', objectName: 'ba_org', type: 'url',
    target: 'https://example.com/rename', locations: ['record_header'],
    requiredPermissions: ['org_admin'],
};

/** The package that binds an action to the owner's object — and owns nothing of its own. */
const BINDER = { id: 'com.test.binder', name: 'binder', actions: [BOUND] };

/** A second object nothing binds to — the control. */
const CONTROL = {
    id: 'com.test.control', name: 'control',
    objects: [{ name: 'ba_control', label: 'Control', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
};

const actionNames = (body: any): string[] => (Array.isArray(body?.actions) ? body.actions.map((a: any) => a?.name) : []);

async function hostWith(packages: any[]) {
    const engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject);
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any);
    for (const pkg of packages) engine.registerApp(structuredClone(pkg));
    return { engine, protocol: new ObjectStackProtocolImplementation(engine) };
}

describe('a bound top-level action reaches another package\'s object as served', () => {
    for (const [order, packages] of [
        ['owner first, binder second', [OWNER, BINDER, CONTROL]],
        ['binder first, owner second', [BINDER, OWNER, CONTROL]],
    ] as const) {
        it(`${order}: GET /meta/object/<target> lists it after the owner's own actions`, async () => {
            const { engine, protocol } = await hostWith([...packages]);
            const served: any = await protocol.getMetaItem({ type: 'object', name: 'ba_org' } as any);
            expect(actionNames(served.item)).toEqual(['own_action', 'rename_org']);
            expect(actionNames(engine.registry.getObject('ba_org'))).toEqual(['own_action', 'rename_org']);
        });
    }

    it('the served entry is the declaration itself — its own gate travels with it unchanged', async () => {
        const { engine } = await hostWith([OWNER, BINDER]);
        const attached: any = engine.registry.getObject('ba_org')?.actions?.find((a: any) => a.name === 'rename_org');
        // By reference: the router's rung 1 (the object's actions) now finds the
        // very item its rung 2 (`registry.getItem('action', name)`) found before.
        expect(attached).toBe(engine.registry.getItem('action', 'rename_org'));
        expect(attached).toMatchObject({ requiredPermissions: ['org_admin'], _packageId: 'com.test.binder' });
    });

    it('the object\'s own actions keep their served order; attached ones follow, ordered by `order`', async () => {
        const owner = structuredClone(OWNER) as any;
        owner.objects[0].actions = [
            { name: 'second', label: 'Second', type: 'url', target: 'https://example.com/2', order: 20 },
            { name: 'first', label: 'First', type: 'url', target: 'https://example.com/1', order: 10 },
        ];
        const binder = {
            id: 'com.test.binder', name: 'binder',
            actions: [{ ...BOUND, name: 'late', order: 5 }, { ...BOUND, name: 'early', order: 1 }],
        };
        const { engine } = await hostWith([owner, binder]);
        expect(actionNames(engine.registry.getObject('ba_org'))).toEqual(['second', 'first', 'early', 'late']);
    });

    it('control: an object nothing binds to is served as declared', async () => {
        const { protocol } = await hostWith([OWNER, BINDER, CONTROL]);
        const served: any = await protocol.getMetaItem({ type: 'object', name: 'ba_control' } as any);
        expect(served.item.actions).toBeUndefined();
    });

    it('a same-stack bound action is attached once, as defineStack already merged it', async () => {
        const stack = defineStack({
            manifest: { id: 'com.test.same', name: 'same', version: '1.0.0', type: 'app' },
            objects: [{ name: 'ba_same', label: 'Same', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
            actions: [{ name: 'same_action', label: 'Same', objectName: 'ba_same', type: 'url', target: 'https://example.com', locations: ['record_header'] }],
        } as any);
        const { protocol } = await hostWith([{ ...stack, ...stack.manifest }]);
        const served: any = await protocol.getMetaItem({ type: 'object', name: 'ba_same' } as any);
        expect(actionNames(served.item)).toEqual(['same_action']);
    });

    it('an action the object already declares under the same name keeps the object\'s declaration', async () => {
        const { engine } = await hostWith([OWNER, { id: 'com.test.twin', name: 'twin', actions: [{ ...BOUND, name: 'own_action' }] }]);
        const actions: any[] = engine.registry.getObject('ba_org')?.actions ?? [];
        expect(actions.map((a) => a.name)).toEqual(['own_action']);
        expect(actions[0].target).toBe('https://example.com/own');
    });

    it('a disabled package\'s bound action is withdrawn, and returns when the package is enabled', async () => {
        const { engine } = await hostWith([OWNER, BINDER]);
        engine.registry.disablePackage('com.test.binder');
        expect(actionNames(engine.registry.getObject('ba_org'))).toEqual(['own_action']);
        engine.registry.enablePackage('com.test.binder');
        expect(actionNames(engine.registry.getObject('ba_org'))).toEqual(['own_action', 'rename_org']);
    });

    it('uninstalling the binding package withdraws the action from the cached object', async () => {
        const { engine } = await hostWith([OWNER, BINDER]);
        expect(actionNames(engine.registry.getObject('ba_org'))).toContain('rename_org');
        engine.registry.unregisterItemsByPackage('com.test.binder');
        expect(actionNames(engine.registry.getObject('ba_org'))).toEqual(['own_action']);
    });
});

// ── The boot refusal: a target no loaded package registers ─────────────────

/** The slice of the `manifest` service these cases call. */
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

/** A plugin that registers each artifact through the `manifest` service during init. */
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

function kernelWith(...plugins: any[]) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    return { kernel, use: async () => { for (const p of plugins) await kernel.use(p); } };
}

describe('the bound-action boot audit', () => {
    it('fails the boot naming the action, its package and the object', async () => {
        const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('binder', [BINDER]));
        await use();
        const err: any = await kernel.bootstrap().then(() => undefined, (e) => e);
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.message).toContain("action 'rename_org' (package 'com.test.binder') is bound to object 'ba_org'");
    });

    it('boots when the target arrives from a package registered LATER in the same boot', async () => {
        const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('binder', [BINDER]), registering('owner', [OWNER]));
        await use();
        await kernel.bootstrap();
        const ql = kernel.getService<ObjectQL>('objectql');
        expect(actionNames(ql.registry.getObject('ba_org'))).toEqual(['own_action', 'rename_org']);
    });

    it('after the boot, an artifact binding to an unknown object is refused before ANY of it registers', async () => {
        const { kernel, use } = kernelWith(new ObjectQLPlugin());
        await use();
        await kernel.bootstrap();
        const manifest = kernel.getService<ManifestService>('manifest');
        expect(() => manifest.register(structuredClone(BINDER))).toThrow(/action 'rename_org' \(package 'com\.test\.binder'\) is bound to object 'ba_org'/);
        const ql = kernel.getService<ObjectQL>('objectql');
        expect(ql.registry.getItem('action', 'rename_org')).toBeUndefined();
    });

    it('after the boot, an artifact binding to a registered object — or to one it brings — registers', async () => {
        const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('owner', [OWNER]));
        await use();
        await kernel.bootstrap();
        const manifest = kernel.getService<ManifestService>('manifest');
        await manifest.register(structuredClone(BINDER));
        await manifest.register({
            id: 'com.test.self', name: 'self',
            objects: [{ name: 'ba_self', label: 'Self', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
            actions: [{ ...BOUND, name: 'self_action', objectName: 'ba_self' }],
        });
        const ql = kernel.getService<ObjectQL>('objectql');
        expect(actionNames(ql.registry.getObject('ba_org'))).toEqual(['own_action', 'rename_org']);
        expect(actionNames(ql.registry.getObject('ba_self'))).toEqual(['self_action']);
    });

    it('the refusal lists every unbound action in one pass, and answers nothing when there is none', () => {
        expect(describeUnboundActionTargets([])).toBeUndefined();
        const err = describeUnboundActionTargets([
            { action: 'a', objectName: 'x', packageId: 'p' },
            { action: 'b', objectName: 'y', packageId: undefined },
        ]);
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err?.message).toContain('2 top-level actions are bound');
        expect(err?.message).toContain("action 'b' (a registration with no package) is bound to object 'y'");
    });
});

// ── The parse a bound action is stored as ─────────────────────────────────

/**
 * [#25649] A package's bound action is stored as its `ActionSchema` parse, so
 * a declared `requiresFeature` is lowered into `visible` exactly as on a
 * platform object's own action (`ObjectSchema.create` parses those where they
 * are authored). Before, the registry stored the item as the package wrote it:
 * served with `requiresFeature` riding along raw and its `visible` the bare
 * predicate — a feature gate no reader enforces.
 */
describe('a bound action is served as its ActionSchema parse', () => {
    /** One declaration, carried both by the owner's object and by a binder package. */
    const GATED = {
        label: 'Change slug', type: 'url' as const, target: 'https://example.com/slug',
        locations: ['record_header' as const], visible: "record.name != ''",
        requiresFeature: 'multiOrgEnabled' as const,
    };
    const LOWERED = { dialect: 'cel', source: "(record.name != '') && features.multiOrgEnabled != false" };

    /** The owner's object as a platform object is authored: parsed by `ObjectSchema.create`. */
    const platformOwner = () => ({
        id: 'com.test.owner', name: 'owner',
        objects: [ObjectSchema.create({
            name: 'ba_org', label: 'Org',
            fields: { name: { name: 'name', type: 'text', label: 'Name' } },
            actions: [{ name: 'own_gated', ...GATED }],
        } as any)],
    });
    const gatedBinder = (action: Record<string, unknown>) => ({ id: 'com.test.binder', name: 'binder', actions: [action] });
    const servedAction = async (protocol: ObjectStackProtocolImplementation, name: string) => {
        const served: any = await protocol.getMetaItem({ type: 'object', name: 'ba_org' } as any);
        return (served.item.actions as any[]).find((a) => a?.name === name);
    };

    it('GET /meta/object/<target> serves the bound action with `requiresFeature` lowered into `visible`', async () => {
        const { engine, protocol } = await hostWith([platformOwner(), gatedBinder({ name: 'change_slug', objectName: 'ba_org', ...GATED })]);
        const bound = await servedAction(protocol, 'change_slug');
        expect(bound.visible).toEqual(LOWERED);
        expect(bound).not.toHaveProperty('requiresFeature');
        // The same lowering the platform object's own action, of the same declaration, is served with.
        expect(bound.visible).toEqual((await servedAction(protocol, 'own_gated')).visible);
        // One parsed body: the attachment is the very item the router's rung 2 resolves.
        expect(engine.registry.getObject('ba_org')?.actions?.find((a: any) => a.name === 'change_slug'))
            .toBe(engine.registry.getItem('action', 'change_slug'));
    });

    it('a bound action with no `visible` of its own is served the gate alone', async () => {
        const { requiresFeature, label, type, target, locations } = GATED;
        const { protocol } = await hostWith([platformOwner(), gatedBinder({ name: 'change_slug', objectName: 'ba_org', label, type, target, locations, requiresFeature })]);
        const bound = await servedAction(protocol, 'change_slug');
        expect(bound.visible).toEqual({ dialect: 'cel', source: 'features.multiOrgEnabled != false' });
        expect(bound).not.toHaveProperty('requiresFeature');
    });

    it('control: the platform object\'s own action is served as `ObjectSchema.create` produced it', async () => {
        const owner = platformOwner();
        const authored = structuredClone(owner.objects[0].actions!.find((a: any) => a.name === 'own_gated'))!;
        const { protocol } = await hostWith([owner, gatedBinder({ name: 'change_slug', objectName: 'ba_org', ...GATED })]);
        expect(await servedAction(protocol, 'own_gated')).toEqual(authored);
        expect(authored.visible).toEqual(LOWERED);
    });

    it('a bound action that does not parse is refused loudly, naming the action and its package — never stored', async () => {
        const host = await hostWith([platformOwner()]);
        const err: any = (() => {
            try { host.engine.registerApp(gatedBinder({ name: 'change_slug', objectName: 'ba_org', ...GATED, visible: false })); }
            catch (e) { return e; }
            return undefined;
        })();
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.message).toContain("Action 'change_slug' of package 'com.test.binder' does not satisfy the action contract");
        expect(err.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'requiresFeature' })]));
        expect(host.engine.registry.getItem('action', 'change_slug')).toBeUndefined();
        expect(actionNames(host.engine.registry.getObject('ba_org'))).toEqual(['own_gated']);
    });
});
