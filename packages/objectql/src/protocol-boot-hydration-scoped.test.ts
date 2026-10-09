// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4624 — boot hydration (`loadMetaFromDb`) grafts each overlay row's
 * protection envelope from ITS OWN package (ADR-0048 / #1828).
 *
 * Pre-fix, the non-object branch of `loadMetaFromDb` kept a third inline
 * copy of the overlay→SchemaRegistry rule and looked the artifact up
 * UNSCOPED (`lookupArtifactItem(type, name)` without the row's
 * `package_id`) — the exact pre-#1828 shape: with two installed packages
 * shipping the same `type`/`name`, a name-colliding overlay row grafted
 * the FIRST-registered package's `_lock`/`_packageId`/`_provenance` onto
 * another package's row at boot (composite-scan first-match by Map
 * iteration order).
 *
 * Post-fix the branch delegates to the ONE shared
 * `hydrateOverlayIntoRegistry` (#4521), so the ADR-0048 package-scoped
 * lookup applies at boot exactly as it does on the read-side hydration
 * and the write-through.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { MetadataManager } from '@objectstack/metadata';
import { createSecurityCatalogReader, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { SchemaRegistry, NAMESPACE_CONFLICT_CODE } from './registry.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

const PKG_A = 'com.acme.a';
const PKG_B = 'com.acme.b';

function artifactPage(pkg: string, label: string) {
    return {
        name: 'home',
        label,
        _packageId: pkg,
        _packageVersion: '1.0.0',
        _provenance: 'package',
        _lock: 'full',
        _lockReason: `Locked by ${pkg}`,
    };
}

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function makeEngine(registry: SchemaRegistry, rows: Row[]) {
    const matches = (r: Row, where: Record<string, unknown>): boolean => {
        for (const [k, v] of Object.entries(where)) {
            if (v === undefined) continue;
            if ((r as any)[k] !== v) return false;
        }
        return true;
    };
    const engine: any = {
        registry,
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return rows.filter((r) => matches(r, opts.where));
        },
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            // [#11957] Pinned to ObjectQL.findOne's OWN #4419 predicate: `findOne`
            // applies limit: 1, so a query naming no record returns an ARBITRARY row
            // and the engine REFUSES it. A double that answers it anyway is how
            // #11767 shipped a bootstrap bypass that was inert on every real
            // deployment while a 641-line unit matrix stayed green.
            assertEngineFindOnePredicate(_t, opts);
            return rows.find((r) => matches(r, opts.where)) ?? null;
        },
        async insert() { return { id: 'x' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate — the twin of
            // the delete pin, on the same argument: a double looser than the engine it
            // stands in for is how #4434 shipped a REST route that 500'd for every
            // caller with its suite green, and a predicate update is no less
            // destructive than a predicate delete.
            assertEngineUpdateDispatch(data, opts);
            return { id: 'x' };
        },
        async delete() { return { deleted: 0 }; },
    };
    return engine;
}

function overlayRow(partial: Partial<Row> & { name: string; metadata: unknown }): Row {
    return {
        id: `r_${partial.name}_${partial.package_id ?? 'global'}`,
        type: 'page',
        organization_id: null,
        package_id: null,
        state: 'active',
        ...partial,
        metadata: typeof partial.metadata === 'string'
            ? partial.metadata
            : JSON.stringify(partial.metadata),
    } as Row;
}

describe('loadMetaFromDb — ADR-0048 package-scoped protection graft at boot (#4624)', () => {
    it('grafts the envelope from the row\'s OWN package, not the first-registered one', async () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        // Package A registers FIRST — pre-fix, the unscoped composite scan
        // returned A for every same-named row, whatever package owned it.
        registry.registerItem('page', artifactPage(PKG_A, 'A Home'), 'name', PKG_A);
        registry.registerItem('page', artifactPage(PKG_B, 'B Home'), 'name', PKG_B);

        const rows = [
            overlayRow({
                name: 'home',
                package_id: PKG_B,
                metadata: { name: 'home', label: 'B Home (customized)' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.loadMetaFromDb();
        expect(res.loaded).toBe(1);
        expect(res.errors).toBe(0);

        // The hydrated plain-key entry carries package B's envelope —
        // pre-fix it carried PKG_A's (`_packageId: 'com.acme.a'`,
        // `_lockReason: 'Locked by com.acme.a'`).
        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('B Home (customized)'); // overlay content wins
        expect(direct._packageId).toBe(PKG_B);
        expect(direct._lock).toBe('full');
        expect(direct._lockReason).toBe(`Locked by ${PKG_B}`);
        expect(direct._provenance).toBe('package');
    });

    it('grafts NO artifact envelope when artifacts have not loaded yet (boot-order no-op)', async () => {
        // Empty registry at hydration time — the scoped lookup finds
        // nothing, exactly like the unscoped one did, and the row
        // registers without a grafted envelope. Artifact-after-hydration
        // boot orders are unaffected by the scoping.
        //
        // [#16702] What the row does carry is the SERVER's own sentence about
        // it — `_provenance: 'org'`, the same one the `object` branch has
        // always stated — because every row this hydrator sees came out of a
        // `sys_metadata` write. That is a statement of authorship, not a graft
        // from an artifact: `_lock` and `_packageId` stay absent, which is what
        // this case is about.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        const rows = [
            overlayRow({
                name: 'home',
                package_id: PKG_B,
                metadata: { name: 'home', label: 'B Home (customized)' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.loadMetaFromDb();
        expect(res.loaded).toBe(1);

        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('B Home (customized)');
        expect(direct._lock).toBeUndefined();
        expect(direct._packageId).toBeUndefined();
        // [#16702] NOT `undefined` — the hydrator states tenant authorship.
        expect(direct._provenance).toBe('org');
    });

    it('keeps the legacy best-effort graft for package-less (global) rows', async () => {
        // A row with no package binding keeps the pre-existing unscoped
        // first-match semantics — identical to the read-side hydration.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        registry.registerItem('page', artifactPage(PKG_A, 'A Home'), 'name', PKG_A);
        registry.registerItem('page', artifactPage(PKG_B, 'B Home'), 'name', PKG_B);

        const rows = [
            overlayRow({
                name: 'home',
                package_id: null,
                metadata: { name: 'home', label: 'Global overlay' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.loadMetaFromDb();

        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('Global overlay');
        // Best-effort first-match: SOME package's envelope is grafted
        // (legacy behaviour, unchanged by #4624 — do not over-pin which).
        expect([PKG_A, PKG_B]).toContain(direct._packageId);
        expect(direct._lock).toBe('full');
    });
});

/**
 * ADR-0131 D4 — which body the security catalog read
 * (`createSecurityCatalogReader`, `@objectstack/core`) resolves for a name two
 * installed packages both ship. RULED (maintainer, Q4 = A on #15196): there is
 * never a second body to choose between. Positions, permission sets and
 * capabilities each hold one name per deployment, so the second package to
 * register a held name is refused at registration, naming both holders
 * (`security-catalog-namespace.ts`; the doors are pinned in
 * `registry-security-catalog-namespace.test.ts`).
 *
 * This describe was the S1 stage's pin of the pre-ruling answer — the
 * FIRST-registered package's body with no stored override, a stored override
 * for every caller with one, and the LATER registration for a position two
 * stacks declared — kept "until the maintainer rules on shared catalog names".
 * It now pins the ruled answer at the same seams: an assignment carries only
 * the NAME, and with one holder every reader answers that holder.
 *
 * It lives beside the #4624 cases because the override case is their
 * consequence: the row the holder stored for itself is hydrated into the bare
 * slot, and the catalog read asks the registry's by-name precedence first. The
 * metadata door's by-name read (`getMetaItem`) is asserted beside each answer,
 * so the pin cannot drift from what the door serves.
 */
describe('security catalog read — a name two packages ship (ADR-0131 D4, ruled: one holder per name)', () => {
    /** A body each catalog type's schema accepts, so hydration reports it valid. */
    const catalogBody = (type: 'permission' | 'position', name: string, label: string) =>
        type === 'permission' ? { name, label, objects: {} } : { name, label };

    type Refusal = Error & { code?: string; status?: number; incomingPackageId?: string; existingHolder?: unknown };
    const refusalOf = (fn: () => unknown): Refusal | undefined => {
        try {
            fn();
            return undefined;
        } catch (e) {
            return e as Refusal;
        }
    };

    function bootWithHolder(type: 'permission' | 'position', name: string, rows: Row[]) {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        // Package A registers FIRST, and holds the name.
        registry.registerItem(type, catalogBody(type, name, `${PKG_A} body`), 'name', PKG_A);
        const protocol = new ObjectStackProtocolImplementation(makeEngine(registry, rows));
        const reader = createSecurityCatalogReader({
            registry,
            metadata: new MetadataManager({ formats: ['json'], loaders: [] }),
        });
        return { registry, protocol, reader };
    }

    describe.each(['permission', 'position'] as const)('%s', (type) => {
        const name = `shared_${type}`;

        it('a second package registering the name is refused, naming both holders; every reader answers the one holder', async () => {
            const { registry, protocol, reader } = bootWithHolder(type, name, []);

            const refusal = refusalOf(() =>
                registry.registerItem(type, catalogBody(type, name, `${PKG_B} body`), 'name', PKG_B),
            );
            expect(refusal?.code).toBe(NAMESPACE_CONFLICT_CODE);
            expect(refusal?.status).toBe(422);
            expect(refusal?.incomingPackageId).toBe(PKG_B);
            expect(refusal?.existingHolder).toEqual({ kind: 'package', packageId: PKG_A });

            expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 0, errors: 0, invalid: 0 });
            const entry = await reader.resolve(type, name);
            expect(entry).toMatchObject({ name, source: 'registry', packageId: PKG_A });
            expect(entry?.definition.label).toBe(`${PKG_A} body`);
            // One entry for the name, and it is the by-name answer.
            expect((await reader.list(type)).filter((e) => e.name === name)).toEqual([entry]);

            const door: any = await protocol.getMetaItem({ type, name });
            expect(door.item?.label).toBe(`${PKG_A} body`);
        });

        it('an override the holder stored for itself: that override, for every caller', async () => {
            const rows = [
                overlayRow({
                    type,
                    name,
                    package_id: PKG_A,
                    metadata: JSON.stringify(catalogBody(type, name, 'stored override')),
                }),
            ];
            const { protocol, reader } = bootWithHolder(type, name, rows);
            expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });

            const entry = await reader.resolve(type, name);
            expect(entry).toMatchObject({ name, source: 'registry', packageId: PKG_A });
            expect(entry?.definition.label).toBe('stored override');
            expect((await reader.list(type)).filter((e) => e.name === name)).toEqual([entry]);

            const door: any = await protocol.getMetaItem({ type, name });
            expect(door.item?.label).toBe('stored override');
            expect(door.item?._packageId).toBe(PKG_A);
        });
    });

    it('a position name two packages declare: the package door refuses the second, so one stack\'s declaration reaches the metadata service', async () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        const metadata = new MetadataManager({ formats: ['json'], loaders: [] });
        // What two app stacks declaring the same position name do at boot: each
        // package is installed (Phase 1, `AppPlugin.init` → `registerApp`) before
        // its in-memory registrar runs (Phase 2, `AppPlugin.start`).
        const stack = (id: string, label: string) =>
            ({ id, name: id, version: '1.0.0', type: 'app', positions: [{ name: 'regional_manager', label }] }) as never;
        registry.installPackage(stack(PKG_A, 'first stack'));
        metadata.registerInMemory('position', 'regional_manager', { name: 'regional_manager', label: 'first stack' });

        const refusal = refusalOf(() => registry.installPackage(stack(PKG_B, 'second stack')));
        expect(refusal?.code).toBe(NAMESPACE_CONFLICT_CODE);
        expect(refusal?.status).toBe(422);
        expect(refusal?.incomingPackageId).toBe(PKG_B);
        expect(refusal?.existingHolder).toEqual({ kind: 'package', packageId: PKG_A });

        const reader = createSecurityCatalogReader({ registry, metadata });
        const entry = await reader.resolve('position', 'regional_manager');
        expect(entry).toMatchObject({ name: 'regional_manager', source: 'metadata' });
        expect(entry?.definition.label).toBe('first stack');
        expect(await reader.list('position')).toEqual([entry]);
    });
});

/**
 * ADR-0048 addendum N.3 — the cold boot (maintainer ruling letter A on #22307,
 * record 6063176077). Every package registers in the kernel's first phase,
 * BEFORE `sys_metadata` hydrates into the registry's bare slot in
 * `ObjectQLPlugin.start`, so the package door cannot see an environment-held
 * name at a cold boot. The hydration write stays unjudged; right after it, the
 * engine plugin judges every package-held position and permission-set name
 * against what it wrote, and refuses the boot with the package door's envelope.
 *
 * These cases boot a real kernel: `ObjectQLPlugin`, a package registered
 * through the real `manifest` service in Phase 1 (what `AppPlugin.init` does),
 * and the real protocol hydrating the stored rows in Phase 2 — over this
 * file's engine double, so the rows are this file's `Row` shape. The refusal
 * leaves `start()`, so the kernel wraps it and the envelope is the wrapper's
 * `cause`. The real composition, restarted on one database, is pinned in
 * `packages/qa/dogfood` and the artifact boot in `packages/runtime`.
 */
describe('cold boot — a package-held catalog name the environment catalog holds refuses the boot (ADR-0048 N.3)', () => {
    type CatalogType = 'permission' | 'position';
    type Envelope = Error & {
        code?: string;
        status?: number;
        conflicts?: Array<{ catalogType: string; name: string; incomingPackageId: string; existingHolder: unknown }>;
    };
    const PKG = 'com.acme.coldboot';
    const catalogBody = (type: CatalogType, name: string, label: string) =>
        type === 'permission' ? { name, label, objects: {} } : { name, label };
    const storedRow = (type: CatalogType, name: string, packageId: string | null = null) =>
        overlayRow({ type, name, package_id: packageId, metadata: JSON.stringify(catalogBody(type, name, 'saved in the environment')) });
    /** A package declaring `decl` — the flat shape `AppPlugin.init` hands the `manifest` service. */
    const pkgOf = (decl: Partial<Record<CatalogType, string[]>>) => ({
        id: PKG,
        name: 'coldboot',
        version: '1.0.0',
        type: 'app',
        ...(decl.position ? { positions: decl.position.map((n) => catalogBody('position', n, 'shipped')) } : {}),
        ...(decl.permission ? { permissions: decl.permission.map((n) => catalogBody('permission', n, 'shipped')) } : {}),
    });

    const kernels: ObjectKernel[] = [];
    afterEach(async () => {
        while (kernels.length) {
            const kernel = kernels.pop()!;
            try { await kernel.shutdown(); } catch { /* a refused boot is already stopped */ }
        }
    });

    /**
     * Boot with `pkg` registered in Phase 1 and `rows` in `sys_metadata`. The
     * second hook lets a case register into the registry in Phase 1 the way a
     * plugin's own `init()` would.
     */
    async function boot(
        pkg: unknown,
        rows: Row[],
        beforeHydration?: (ql: ObjectQL) => void,
    ): Promise<{ refusal?: Envelope; ql: ObjectQL }> {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        kernels.push(kernel);
        let ql!: ObjectQL;
        await kernel.use(new ObjectQLPlugin({ registerProtocol: false }));
        const storedRowsAndPackage: Plugin = {
            name: 'test.stored-rows-and-package',
            version: '1.0.0',
            dependencies: ['com.objectstack.engine.objectql'],
            init: async (ctx: PluginContext) => {
                ql = ctx.getService<ObjectQL>('objectql');
                ql.registry.logLevel = 'silent';
                ctx.registerService('protocol', new ObjectStackProtocolImplementation(makeEngine(ql.registry, rows)));
                await ctx.getService<{ register(m: unknown): Promise<void> | void }>('manifest').register(pkg);
                beforeHydration?.(ql);
            },
        };
        await kernel.use(storedRowsAndPackage);
        try {
            await kernel.bootstrap();
            return { ql };
        } catch (e) {
            return { refusal: ((e as { cause?: unknown }).cause ?? e) as Envelope, ql };
        }
    }

    const environmentConflict = (type: CatalogType, name: string) =>
        ({ catalogType: type, name, incomingPackageId: PKG, existingHolder: { kind: 'environment' } });

    describe.each(['permission', 'position'] as const)('%s', (type) => {
        const name = `coldboot_${type}`;

        it('a package-held name the environment catalog already holds refuses the boot, naming both holders', async () => {
            const { refusal } = await boot(pkgOf({ [type]: [name] }), [storedRow(type, name)]);
            expect(refusal?.code).toBe(NAMESPACE_CONFLICT_CODE);
            expect(refusal?.status).toBe(422);
            expect(refusal?.conflicts).toEqual([environmentConflict(type, name)]);
        });

        it('a stored row bound to the package itself is the environment\'s too (a hot install refuses it alike)', async () => {
            const { refusal } = await boot(pkgOf({ [type]: [name] }), [storedRow(type, name, PKG)]);
            expect(refusal?.code).toBe(NAMESPACE_CONFLICT_CODE);
            expect(refusal?.conflicts).toEqual([environmentConflict(type, name)]);
        });

        it('CONTROL — the environment\'s own names and the package\'s distinct names: the boot comes up, each answers its own', async () => {
            const { refusal, ql } = await boot(pkgOf({ [type]: [`${name}_shipped`] }), [storedRow(type, `${name}_saved`)]);
            expect(refusal).toBeUndefined();
            expect(ql.registry.getItem<{ _packageId?: string }>(type, `${name}_shipped`)?._packageId).toBe(PKG);
            expect(ql.registry.getItem<{ label?: string }>(type, `${name}_saved`)?.label).toBe('saved in the environment');
        });
    });

    it('every conflict is listed in one refusal, positions first, each name once', async () => {
        const { refusal } = await boot(
            pkgOf({ position: ['coldboot_both_position'], permission: ['coldboot_both_set', 'coldboot_free_set'] }),
            [storedRow('permission', 'coldboot_both_set'), storedRow('position', 'coldboot_both_position')],
        );
        expect(refusal?.conflicts).toEqual([
            environmentConflict('position', 'coldboot_both_position'),
            environmentConflict('permission', 'coldboot_both_set'),
        ]);
    });

    it('CONTROL — a built-in name the platform declares beside a stored definition boots (the item seam\'s carve-out)', async () => {
        // The platform's own declaration of a built-in position, made at the
        // item seam under its own package id, here in Phase 1 so it is
        // package-held when the check runs; and a stored definition under the
        // same name, which shadows it at read (ADR-0005).
        const { refusal, ql } = await boot(pkgOf({}), [storedRow('position', 'org_admin')], (engine) => {
            engine.registry.registerItem('position', { name: 'org_admin', label: 'Organization Admin' }, 'name', 'com.objectstack.plugin-security');
        });
        expect(refusal).toBeUndefined();
        expect(ql.registry.getItem<{ label?: string }>('position', 'org_admin')?.label).toBe('saved in the environment');
    });
});
