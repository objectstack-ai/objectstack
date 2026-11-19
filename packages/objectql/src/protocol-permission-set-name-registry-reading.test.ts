// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata doors' half of the security catalog's "one name, one holder"
 * for a permission set (maintainer rulings Q4 = A, record 6050490870, and A,
 * record 6063176077) reads WHO HOLDS A NAME through this package's own
 * reading — the package half `findPackageHeldSecurityCatalogNames` exports and
 * the cold boot meets with the environment catalog — never a second derivation
 * beside it (ruling letter B, record 6074838935).
 *
 * `@objectstack/metadata-protocol` cannot import this package (this package
 * depends on it), so its predicate (`permissionSetNameCollisionRefusal`, in
 * `protocol-save-door-refusals.ts`) asks the same registry member the export
 * asks. These pins hold that seam from the side that sees both halves: the
 * real composition — `ObjectQLPlugin` binding the real protocol to a real
 * `ObjectQL` engine and its `SchemaRegistry` — so a rename of the member, or a
 * door that stops asking it, reds here, where the metadata-protocol suite's
 * registry double could not notice.
 *
 * The holder is an install CLAIM: a package whose manifest declares a
 * permission set, installed with no item registered, so no packaged lock seals
 * the name and the save door's name rule is the refusal that answers. The
 * metadata-protocol suite `protocol.permission-set-name-cross-package.test.ts`
 * pins the doors, the owner each judges and the stored half.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
    bindSecurityCatalogReader,
    createSecurityCatalogReader,
    holdsPlatformPermissionSet,
    ObjectKernel,
    PERMISSION_SET_SHARED_NAMESPACES,
    permissionSetHoldersMeet,
    resolveUserAuthzGrants,
} from '@objectstack/core';
import { namespacedHoldersMeet } from '@objectstack/spec/kernel';
import { isTenantAuthored } from '@objectstack/metadata-core';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { findPackageHeldSecurityCatalogNames, RESERVED_NAMESPACES, SecurityCatalogNameConflictError } from './registry.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory driver, copied from `protocol-adopt-orphans-object-registry.test.ts`;
 * equality-only WHERE.
 */
function makeMemoryDriver(stores: Stores) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
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
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = (data.id as string) ?? `r_${randomUUID()}`;
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
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
        async dropTable(object: string) { stores.delete(object); },
    };
    return driver;
}

/**
 * What one grant of the permission set `name`, bound to the package `column`
 * (`null`: no package column), confers to a member of `org_a`, read by the
 * authorization resolver through `catalog`.
 */
async function grantConfers(engine: ObjectQL, catalog: unknown, name: string, column: string | null): Promise<unknown> {
    const rows: Record<string, unknown[]> = {
        sys_user: [{ id: 'u1', email: 'u1@example.com' }],
        sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'member' }],
        sys_user_permission_set: [{ user_id: 'u1', permission_set: name, permission_set_package: column, organization_id: 'org_a' }],
    };
    const ql = { registry: engine.registry, find: async (object: string) => rows[object] ?? [], findOne: async (object: string, query?: any) => { assertEngineFindOnePredicate(object, query); return rows[object]?.[0]; }, count: async () => 0 };
    bindSecurityCatalogReader(ql, catalog as any);
    return (await resolveUserAuthzGrants(ql, 'u1', { tenantId: 'org_a' })).systemPermissions;
}

/** The package whose install declares the set's name, and a second installed package. */
const HOLDER = 'com.qa.holder';
const OTHER = 'com.qa.other';
const SET = 'qa_claimed_editor';
const permissionSet = (name: string) => ({ name, label: 'Editor', objects: {} });

describe('the metadata doors read who holds a permission-set name through the registry\'s own reading', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    async function boot(stores: Stores): Promise<{ engine: ObjectQL; protocol: any }> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        engine.registry.logLevel = 'silent';
        // Both installed as authored bases (a save naming an uninstalled
        // package is refused first); the holder's manifest declares the set,
        // which records the claim and registers no item.
        engine.registry.installPackage(
            { id: HOLDER, name: HOLDER, version: '1.0.0', permissions: [permissionSet(SET)] } as any, 'authored',
        );
        engine.registry.installPackage({ id: OTHER, name: OTHER, version: '1.0.0' } as any, 'authored');
        return { engine, protocol: (kernel as any).getService('protocol') };
    }

    const storedSets = (stores: Stores) => Array.from(stores.get('sys_metadata')?.values() ?? [])
        .filter((r) => r.type === 'permission')
        .map((r) => ({ name: r.name, binding: r.package_id ?? null }));

    async function refusal(run: () => Promise<unknown>): Promise<any> {
        try {
            await run();
        } catch (error) {
            return error;
        }
        return undefined;
    }

    it('the reading the doors meet is the exported one: the claim names the holder', async () => {
        const { engine } = await boot(new Map());
        expect(findPackageHeldSecurityCatalogNames(engine.registry)
            .filter((entry) => entry.catalogType === 'permission' && entry.name === SET))
            .toEqual([{ catalogType: 'permission', name: SET, packageIds: [HOLDER] }]);
    });

    it.each([
        ['another installed package', OTHER],
        ['the environment (no package)', undefined],
    ] as const)('%s cannot save a set of the claimed name — NAMESPACE_CONFLICT / 422 naming the holder, nothing stored', async (_who, packageId) => {
        const stores: Stores = new Map();
        const { protocol } = await boot(stores);

        const error = await refusal(() => protocol.saveMetaItem({
            type: 'permission', name: SET, item: permissionSet(SET), ...(packageId ? { packageId } : {}),
        }));

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('NAMESPACE_CONFLICT');
        expect(error.status).toBe(422);
        expect(error.message).toContain(`package "${HOLDER}"`);
        expect(storedSets(stores)).toEqual([]);
    });

    it('CONTROL: a name no package declares saves, for another package and for the environment', async () => {
        const stores: Stores = new Map();
        const { protocol } = await boot(stores);

        const packaged = await protocol.saveMetaItem({
            type: 'permission', name: 'qa_other_editor', item: permissionSet('qa_other_editor'), packageId: OTHER,
        });
        const environment = await protocol.saveMetaItem({
            type: 'permission', name: 'qa_env_editor', item: permissionSet('qa_env_editor'),
        });

        expect(packaged.success).toBe(true);
        expect(environment.success).toBe(true);
        expect(storedSets(stores)).toEqual([
            { name: 'qa_other_editor', binding: OTHER },
            { name: 'qa_env_editor', binding: null },
        ]);
    });
});


/**
 * [ADR-0150 D2/D9, #31698] A permission set is one name per NAMESPACE, judged
 * by ONE predicate — `permissionSetHoldersMeet` (`@objectstack/core`) — that
 * the install gate (the registry's package door and its item seam) and the
 * metadata save door both ask. Each row below runs all three doors over the
 * real composition, FROM `main` → TO this change:
 *
 * | pair (holder + incoming)            | install gate         | item seam            | save door            | sibling `namespacedHoldersMeet` |
 * |-------------------------------------|----------------------|----------------------|----------------------|---------------------------------|
 * | `crm` + `hr` (CONTROL)              | refused → admitted   | refused → admitted   | refused → admitted   | admits                          |
 * | `sys` + `crm`                       | refused (unchanged)  | refused (unchanged)  | refused (unchanged)  | admits ← the difference         |
 * | `base` + `crm`                      | refused (unchanged)  | refused (unchanged)  | refused (unchanged)  | admits ← the difference         |
 * | `guest_portal`, `crm` + `hr`        | refused (unchanged)  | refused (unchanged)  | refused (unchanged)  | admits ← the difference         |
 * | no namespace + `crm`                | refused (unchanged)  | refused (unchanged)  | refused (unchanged)  | refuses, as here                |
 */
describe('[#31698] a permission set is one name per namespace: one predicate, three doors', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    async function bootBare(): Promise<{ engine: ObjectQL; protocol: any }> {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(new Map()), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        engine.registry.logLevel = 'silent';
        return { engine, protocol: (kernel as any).getService('protocol') };
    }

    const HOLDING = 'com.qa.holding';
    const INCOMING = 'com.qa.incoming';
    const manifest = (id: string, namespace: string | undefined, sets: string[] = []) =>
        ({ id, name: id, version: '1.0.0', ...(namespace ? { namespace } : {}), ...(sets.length ? { permissions: sets.map(permissionSet) } : {}) }) as any;

    /**
     * Each door's answer for the incoming package: `admitted`, or `refused` with the rule's own error.
     * `disableHolder` disables the holding package before the incoming one arrives.
     */
    async function doors(holderNs: string | undefined, incomingNs: string | undefined, name: string, opts: { disableHolder?: boolean } = {}) {
        const answer = async (run: () => unknown, refusedBy: (e: any) => boolean) => {
            try { await run(); return 'admitted'; } catch (error) {
                if (refusedBy(error)) return 'refused';
                throw error;
            }
        };
        const conflict = (e: any) => e instanceof SecurityCatalogNameConflictError;
        // The install gate: the holder's claim, then the incoming manifest declaring the name.
        const install = await bootBare();
        install.engine.registry.installPackage(manifest(HOLDING, holderNs, [name]), 'authored');
        if (opts.disableHolder) install.engine.registry.disablePackage(HOLDING);
        const installGate = await answer(() => install.engine.registry.installPackage(manifest(INCOMING, incomingNs, [name]), 'authored'), conflict);
        // The item seam: the incoming package installed with no claim, then registering the set's item.
        const seam = await bootBare();
        seam.engine.registry.installPackage(manifest(HOLDING, holderNs, [name]), 'authored');
        if (opts.disableHolder) seam.engine.registry.disablePackage(HOLDING);
        seam.engine.registry.installPackage(manifest(INCOMING, incomingNs), 'authored');
        const itemSeam = await answer(() => seam.engine.registry.registerItem('permission', permissionSet(name), 'name', INCOMING), conflict);
        // The save door: the incoming package (holding no item of the name) saves a set of it.
        const save = await bootBare();
        save.engine.registry.installPackage(manifest(HOLDING, holderNs, [name]), 'authored');
        if (opts.disableHolder) save.engine.registry.disablePackage(HOLDING);
        save.engine.registry.installPackage(manifest(INCOMING, incomingNs), 'authored');
        const saveDoor = await answer(
            () => save.protocol.saveMetaItem({ type: 'permission', name, item: permissionSet(name), packageId: INCOMING }),
            (e: any) => e?.code === 'NAMESPACE_CONFLICT' && e?.status === 422,
        );
        return { installGate, itemSeam, saveDoor };
    }

    const refusedEverywhere = { installGate: 'refused', itemSeam: 'refused', saveDoor: 'refused' };

    it('CONTROL crm + hr: admitted at all three doors (FROM refused at all three)', async () => {
        expect(await doors('crm', 'hr', 'qa_reader')).toEqual({ installGate: 'admitted', itemSeam: 'admitted', saveDoor: 'admitted' });
    });

    it('crm + hr where crm STORES its set (no shipped one): the save door admits hr\'s, and each set is served at its own package (FROM refused, #32780)', async () => {
        // FROM (main at the change): `422 NAMESPACE_CONFLICT` naming crm, "a
        // set another package stores holds its name": the registry kept one
        // bare entry per stored set of a name, so hr's would take crm's place.
        const { engine, protocol } = await bootBare();
        engine.registry.installPackage(manifest(HOLDING, 'crm'), 'authored');
        engine.registry.installPackage(manifest(INCOMING, 'hr'), 'authored');
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_reader', item: { ...permissionSet('qa_reader'), label: 'crm' }, packageId: HOLDING });
        expect(engine.registry.packageScopedHoldersOf('permission', 'qa_reader', null)).toEqual([HOLDING]);
        const saved = await protocol.saveMetaItem({ type: 'permission', name: 'qa_reader', item: { ...permissionSet('qa_reader'), label: 'hr' }, packageId: INCOMING });
        expect(saved.success).toBe(true);
        expect([...engine.registry.packageScopedHoldersOf('permission', 'qa_reader', null)].sort()).toEqual([HOLDING, INCOMING]);
        const label = (id: string) => (engine.registry.getPackageScopedItem('permission', 'qa_reader', id) as { label?: string } | undefined)?.label;
        expect([label(HOLDING), label(INCOMING)]).toEqual(['crm', 'hr']);
    });

    it.each([
        ['sys + crm', 'sys', 'crm', 'qa_reader'],
        ['crm + sys', 'crm', 'sys', 'qa_reader'],
        ['base + crm', 'base', 'crm', 'qa_reader'],
        ['guest_portal, crm + hr', 'crm', 'hr', 'guest_portal'],
        ['no namespace + crm', undefined, 'crm', 'qa_reader'],
    ] as const)('%s: refused at all three doors, unchanged', async (_pair, holderNs, incomingNs, name) => {
        expect(await doors(holderNs, incomingNs, name)).toEqual(refusedEverywhere);
    });

    it('the difference from the sibling predicate: sys, base and guest_portal stay one holder here', () => {
        const rows = [
            { pair: 'crm + hr', a: 'crm', b: 'hr', name: 'qa_reader' },
            { pair: 'sys + crm', a: 'sys', b: 'crm', name: 'qa_reader' },
            { pair: 'base + crm', a: 'base', b: 'crm', name: 'qa_reader' },
            { pair: 'guest_portal, crm + hr', a: 'crm', b: 'hr', name: 'guest_portal' },
            { pair: 'no namespace + crm', a: undefined, b: 'crm', name: 'qa_reader' },
        ];
        expect(rows.map((r) => ({ pair: r.pair, sibling: namespacedHoldersMeet(r.a, r.b), permission: permissionSetHoldersMeet(r.a, r.b, r.name) }))).toEqual([
            { pair: 'crm + hr', sibling: false, permission: false },
            { pair: 'sys + crm', sibling: false, permission: true },
            { pair: 'base + crm', sibling: false, permission: true },
            { pair: 'guest_portal, crm + hr', sibling: false, permission: true },
            { pair: 'no namespace + crm', sibling: true, permission: true },
        ]);
    });

    it('the predicate\'s shared namespaces are the registry\'s shareable ones', () => {
        expect([...PERMISSION_SET_SHARED_NAMESPACES].sort()).toEqual([...RESERVED_NAMESPACES, 'sys'].sort());
    });

    it('two admitted holders: both claims are remembered, each released by its own uninstall', async () => {
        const { engine } = await bootBare();
        engine.registry.installPackage(manifest(HOLDING, 'crm', ['qa_reader']), 'authored');
        engine.registry.installPackage(manifest(INCOMING, 'hr', ['qa_reader']), 'authored');
        const holders = () => findPackageHeldSecurityCatalogNames(engine.registry)
            .filter((entry) => entry.catalogType === 'permission' && entry.name === 'qa_reader')
            .flatMap((entry) => entry.packageIds).sort();
        expect(holders()).toEqual([HOLDING, INCOMING]);
        expect(engine.registry.securityCatalogNamesHeldBy(INCOMING, 'permission')).toEqual(['qa_reader']);
        engine.registry.uninstallPackage(INCOMING);
        expect(holders()).toEqual([HOLDING]);
        // …and a third package that meets the holder (no namespace) is still refused beside it.
        expect(() => engine.registry.installPackage(manifest('com.qa.third', undefined, ['qa_reader']), 'authored')).toThrow(SecurityCatalogNameConflictError);
    });

    /**
     * [#31698, 6816011109 row 9] Two holders of one name, one of them disabled.
     * `holdsPlatformPermissionSet` reads a name held with no address over the
     * registry's holders; its "platform holder enabled, other holder disabled"
     * row needs a second holder of a set a platform (`sys`) package holds,
     * which the doors refuse, while that holder is disabled too. The column-less
     * grant of a name two namespaces hold, one disabled, is the reachable half:
     * its pinned answer is `main`'s at this change's merge.
     */
    it('row 9: a second holder of a platform (sys) set is refused at every door, also while the holder is disabled', async () => {
        expect(await doors('sys', 'crm', 'qa_reader', { disableHolder: true })).toEqual(refusedEverywhere);
    });

    // Row 9's own state is the platform holder ENABLED beside a DISABLED other
    // holder. Reached in the other order: the other holder is installed and
    // disabled first, and the platform package arrives second.
    it('row 9: a platform (sys) package arriving beside a disabled holder of the name is refused at every door', async () => {
        expect(await doors('crm', 'sys', 'qa_reader', { disableHolder: true })).toEqual(refusedEverywhere);
    });

    /**
     * Row 9's verdict through this change's doors: `holdsPlatformPermissionSet`
     * for a context holding the name with no address. The platform holder is
     * the one holder: every door refuses the second, so the verdict follows the
     * platform holder alone — `true` while enabled, and `main`'s answer at this
     * change's merge while it is disabled.
     */
    it('row 9: the verdict for a name with no address follows the one platform holder, the second holder refused (main at the merge)', async () => {
        const { engine } = await bootBare();
        engine.registry.installPackage(manifest(HOLDING, 'sys'), 'authored');
        engine.registry.registerItem('permission', permissionSet('qa_reader') as any, 'name', HOLDING);
        const verdict = () => holdsPlatformPermissionSet(engine, { permissions: ['qa_reader'] }, 'qa_reader');
        expect(verdict()).toBe(true);
        engine.registry.installPackage(manifest(INCOMING, 'crm'), 'authored');
        expect(() => engine.registry.registerItem('permission', permissionSet('qa_reader') as any, 'name', INCOMING)).toThrow(SecurityCatalogNameConflictError);
        // CONTROL: an address carried with the name answers by that holder alone.
        expect(holdsPlatformPermissionSet(engine, { permissions: ['qa_reader'], permissionSetAddresses: [{ packageId: INCOMING, name: 'qa_reader' }] }, 'qa_reader')).toBe(false);
        engine.registry.disablePackage(HOLDING);
        expect(() => engine.registry.registerItem('permission', permissionSet('qa_reader') as any, 'name', INCOMING)).toThrow(SecurityCatalogNameConflictError);
        expect(verdict()).toBe(false);
    });

    it('row 9: a column-less grant of a name crm and hr hold, hr disabled, confers what main answers (the bound grants as CONTROLs)', async () => {
        const { engine } = await bootBare();
        const set = (cap: string) => ({ ...permissionSet('qa_reader'), systemPermissions: [cap] });
        engine.registry.installPackage(manifest(HOLDING, 'crm'), 'authored');
        engine.registry.installPackage(manifest(INCOMING, 'hr'), 'authored');
        engine.registry.registerItem('permission', set('cap_crm') as any, 'name', HOLDING);
        engine.registry.registerItem('permission', set('cap_hr') as any, 'name', INCOMING);
        const catalog = createSecurityCatalogReader({ registry: engine.registry as any, metadata: { get: () => undefined, list: () => [] } as any });
        /** What one grant of `qa_reader` with this column confers, read by the authorization resolver. */
        const confers = (column: string | null) => grantConfers(engine, catalog, 'qa_reader', column);
        const read = async () => ({ columnLess: await confers(null), crm: await confers(HOLDING), hr: await confers(INCOMING) });
        expect(await read()).toEqual({ columnLess: [], crm: ['cap_crm'], hr: ['cap_hr'] });
        engine.registry.disablePackage(INCOMING);
        // main's answer at the merge: the column-less grant stays refused, and the
        // disabled holder's grant is never re-targeted to the enabled holder's set.
        expect(await read()).toEqual({ columnLess: [], crm: ['cap_crm'], hr: [] });
    });
});

/**
 * [ADR-0150 D2/D3 "security catalog: permission sets by (package, name)",
 * #32780] Two packages of two namespaces each STORE a permission set of one
 * name (a runtime package duplicated into another namespace). The host kernel
 * keeps each stored set in its package's own registry slot — the hydrator's
 * package overlay slot, at the write-through and at the boot hydration alike —
 * so each package's grants confer its own set, across a restart, in either
 * order the store reads the rows; a delete of either set leaves the other
 * served; and each set stays tenant-authored (the lock's provenance input,
 * `_provenance: 'org'`, bound to its own package), never a shipped one.
 *
 * FROM (main at the change): the save door refused the second namespace's
 * stored set (`422 NAMESPACE_CONFLICT`, "a set another package stores holds its
 * name"), and a set stored beside a set another namespace SHIPS was not served
 * at its own package.
 *
 * The restart is a second kernel over the same driver stores, the packages
 * installed before its boot hydration (`ObjectQLPlugin.start`), as a cold boot
 * registers them in its first phase.
 */
describe('[#32780] two namespaces\' stored permission sets of one name: each served at its own package', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    const CRM = 'com.qa.crm';
    const HR = 'com.qa.hr';
    const FIN = 'com.qa.fin';
    /** A second package of the `crm` namespace: its co-owner (CONTROL). */
    const CRM_TWO = 'com.qa.crm_two';
    const CRM_CUSTOM = `${CRM}.custom`;
    const NS: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr', [FIN]: 'fin', [CRM_TWO]: 'crm', [CRM_CUSTOM]: 'crmx' };
    const N = 'qa_shared_reader';
    const setOf = (cap: string) => ({ ...permissionSet(N), label: cap, systemPermissions: [cap] });
    const manifestOf = (id: string, sets: string[] = []) =>
        ({
            id, name: id, version: '1.0.0', namespace: NS[id],
            // crm_two co-owns the `crm` namespace by a declared dependency (ADR-0141 D5).
            ...(id === CRM_TWO ? { dependencies: { [CRM]: '^1.0.0' } } : {}),
            ...(sets.length ? { permissions: sets.map(permissionSet) } : {}),
        }) as any;

    /** Boot over `stores`, with `installs` installed (declaring `declares`' sets) before the boot hydration reads the stored rows. */
    async function boot(stores: Stores, installs: readonly string[], before?: (engine: ObjectQL) => void, declares: Record<string, string[]> = {}): Promise<{ engine: ObjectQL; protocol: any }> {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registry.logLevel = 'silent';
        engine.registerDriver(makeMemoryDriver(stores), true);
        for (const id of installs) engine.registry.installPackage(manifestOf(id, declares[id]), 'authored');
        before?.(engine);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        engine.registry.logLevel = 'silent';
        return { engine, protocol: (kernel as any).getService('protocol') };
    }

    /** `stores` with its stored rows in reverse order, so the next boot hydration reads them the other way round. */
    function reversedRows(stores: Stores): Stores {
        const out: Stores = new Map(stores);
        out.set('sys_metadata', new Map([...(stores.get('sys_metadata') ?? new Map())].reverse()));
        return out;
    }

    /** What one grant of {@link N} with this package column confers, read by the authorization resolver. */
    async function confers(engine: ObjectQL, column: string | null): Promise<unknown> {
        const catalog = createSecurityCatalogReader({ registry: engine.registry as any, metadata: { get: () => undefined, list: () => [] } as any });
        return grantConfers(engine, catalog, N, column);
    }

    /** Each package's grant, by its package column. */
    const grants = async (engine: ObjectQL, ids: readonly string[]) =>
        Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await confers(engine, id)] as const)));

    /**
     * The lock's provenance input for every registry item of {@link N}: the
     * classifier reads a set as shipped only from an item that is not
     * tenant-authored and carries a package (`packaged-permission-set-lock.ts`).
     */
    const provenance = (engine: ObjectQL) => (engine.registry.listItems('permission') as any[])
        .filter((item) => item?.name === N)
        .map((item) => ({ packageId: item._packageId, tenantAuthored: isTenantAuthored(item) }))
        .sort((a, b) => String(a.packageId).localeCompare(String(b.packageId)));

    const save = (protocol: any, id: string, cap: string) =>
        protocol.saveMetaItem({ type: 'permission', name: N, item: setOf(cap), packageId: id });

    async function refusal(run: () => Promise<unknown>): Promise<any> {
        try { await run(); } catch (error) { return error; }
        return undefined;
    }

    for (const order of [[CRM, HR], [HR, CRM]] as const) {
        const tag = `${NS[order[0]]} saves first`;

        it(`${tag}: both stored sets land, each package's grant confers its own set, neither is locked, and so after a restart in either read order`, async () => {
            const stores: Stores = new Map();
            const first = await boot(stores, [CRM, HR]);
            for (const id of order) expect((await save(first.protocol, id, `cap_${NS[id]}`)).success, `${id}'s save`).toBe(true);
            const served = { [CRM]: ['cap_crm'], [HR]: ['cap_hr'] };
            expect(await grants(first.engine, [CRM, HR]), 'the running kernel').toEqual(served);
            // A grant naming no package of a name two packages hold confers nothing (ADR-0150 D3).
            expect(await confers(first.engine, null)).toEqual([]);
            const tenantSets = [{ packageId: CRM, tenantAuthored: true }, { packageId: HR, tenantAuthored: true }];
            expect(provenance(first.engine), 'neither set reads as shipped').toEqual(tenantSets);

            for (const [reading, rows] of [['store order', stores], ['reversed', reversedRows(stores)]] as const) {
                for (const installs of [[CRM, HR], [HR, CRM]] as const) {
                    const restarted = await boot(rows, installs);
                    const at = `restart (${reading}, ${NS[installs[0]]} installed first)`;
                    expect(await grants(restarted.engine, [CRM, HR]), at).toEqual(served);
                    expect(provenance(restarted.engine), at).toEqual(tenantSets);
                }
            }
        });

        for (const deleted of [CRM, HR] as const) {
            const kept = deleted === CRM ? HR : CRM;
            it(`${tag}: a delete of ${NS[deleted]}'s set retires its slot alone, and ${NS[kept]}'s stays served, also after a restart`, async () => {
                const stores: Stores = new Map();
                const { engine, protocol } = await boot(stores, [CRM, HR]);
                for (const id of order) await save(protocol, id, `cap_${NS[id]}`);
                await protocol.deleteMetaItem({ type: 'permission', name: N, packageId: deleted });
                const after = { [deleted]: [], [kept]: [`cap_${NS[kept]}`] };
                expect(await grants(engine, [CRM, HR]), 'the running kernel').toEqual(after);
                expect(engine.registry.packageScopedHoldersOf('permission', N, null)).toEqual([kept]);
                // One holder left: a grant naming no package confers its set.
                expect(await confers(engine, null)).toEqual([`cap_${NS[kept]}`]);
                const restarted = await boot(stores, [CRM, HR]);
                expect(await grants(restarted.engine, [CRM, HR]), 'after a restart').toEqual(after);
            });
        }
    }

    it('crm declares a set, hr saves one of the name, then crm saves its own and a third namespace saves one: each lands and each is served at its own package (FROM: crm\'s and fin\'s saves refused naming hr)', async () => {
        const stores: Stores = new Map();
        const { engine, protocol } = await boot(stores, [CRM, HR, FIN], undefined, { [CRM]: [N] });
        expect((await save(protocol, HR, 'cap_hr')).success, 'hr\'s save beside crm\'s declared set').toBe(true);
        expect((await save(protocol, FIN, 'cap_fin')).success, 'a third namespace\'s save').toBe(true);
        const othersOnly: Stores = new Map([...stores].map(([table, rows]) => [table, new Map(rows)]));
        expect((await save(protocol, CRM, 'cap_crm')).success, 'crm\'s own save').toBe(true);
        const served = { [CRM]: ['cap_crm'], [HR]: ['cap_hr'], [FIN]: ['cap_fin'] };
        expect(await grants(engine, [CRM, HR, FIN]), 'the running kernel').toEqual(served);
        expect(await confers(engine, null)).toEqual([]);
        // The other namespaces' stored sets are their own packages': a restart beside crm's declared set boots and serves each.
        for (const rows of [othersOnly, reversedRows(othersOnly)]) {
            const restarted = await boot(rows, [CRM, HR, FIN], undefined, { [CRM]: [N] });
            expect(await grants(restarted.engine, [HR, FIN]), 'after a restart').toEqual({ [HR]: ['cap_hr'], [FIN]: ['cap_fin'] });
        }
    });

    it('CONTROL (ADR-0048 N.3) — a stored set bound to the package that declares the name is the environment\'s at the cold boot, as before: the restart is refused naming that package alone', async () => {
        const stores: Stores = new Map();
        const first = await boot(stores, [CRM, HR], undefined, { [CRM]: [N] });
        expect((await save(first.protocol, HR, 'cap_hr')).success).toBe(true);
        expect((await save(first.protocol, CRM, 'cap_crm')).success).toBe(true);
        for (const rows of [stores, reversedRows(stores)]) {
            const error: any = await refusal(() => boot(rows, [CRM, HR], undefined, { [CRM]: [N] }));
            const envelope = error?.cause ?? error;
            expect([envelope?.code, envelope?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
            expect(envelope?.conflicts).toEqual([{ catalogType: 'permission', name: N, incomingPackageId: CRM, existingHolder: { kind: 'environment' } }]);
        }
    });

    it('a set hr stores, then crm ships a set of the name: after a restart in either read order crm\'s grant confers the set crm ships and hr\'s the set hr stores, and only crm\'s reads as shipped', async () => {
        const stores: Stores = new Map();
        const first = await boot(stores, [CRM, HR]);
        expect((await save(first.protocol, HR, 'cap_hr')).success).toBe(true);
        // crm's set is registered before the boot hydration, as a cold boot registers a package's items.
        const ship = (target: ObjectQL) => target.registry.registerItem('permission', setOf('cap_crm_shipped') as any, 'name', CRM);
        for (const rows of [stores, reversedRows(stores)]) {
            const restarted = await boot(rows, [CRM, HR], ship);
            expect(await grants(restarted.engine, [CRM, HR]), 'after a restart').toEqual({ [CRM]: ['cap_crm_shipped'], [HR]: ['cap_hr'] });
            expect(provenance(restarted.engine)).toEqual([
                { packageId: CRM, tenantAuthored: false }, { packageId: HR, tenantAuthored: true },
            ]);
        }
    });

    const packageConflict = (incoming: string, holder: string) =>
        ({ catalogType: 'permission', name: N, incomingPackageId: incoming, existingHolder: { kind: 'package', packageId: holder } });
    const environmentConflict = (incoming: string) =>
        ({ catalogType: 'permission', name: N, incomingPackageId: incoming, existingHolder: { kind: 'environment' } });
    const envelopeOf = (error: any) => {
        const envelope = error?.cause ?? error;
        return { code: envelope?.code, status: envelope?.status, conflicts: envelope?.conflicts };
    };

    it('a package\'s stored set counts as its holding of the name: a package of the same namespace declaring or registering the name after it is refused, and before it the save is refused', async () => {
        // The stored set first, then the second holder: the package door and the item seam.
        const stores: Stores = new Map();
        const { engine, protocol } = await boot(stores, [CRM]);
        expect((await save(protocol, CRM, 'cap_crm')).success).toBe(true);
        const installed = await refusal(async () => engine.registry.installPackage(manifestOf(CRM_TWO, [N]), 'authored'));
        expect(envelopeOf(installed)).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422, conflicts: [packageConflict(CRM_TWO, CRM)] });
        engine.registry.installPackage(manifestOf(CRM_TWO), 'authored');
        const registered = await refusal(async () => engine.registry.registerItem('permission', setOf('cap_crm_two') as any, 'name', CRM_TWO));
        expect(envelopeOf(registered)).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422, conflicts: [packageConflict(CRM_TWO, CRM)] });
        expect(await grants(engine, [CRM])).toEqual({ [CRM]: ['cap_crm'] });
        // The second holder first, then the stored set: the save door.
        const other = await boot(new Map(), [CRM]);
        other.engine.registry.installPackage(manifestOf(CRM_TWO, [N]), 'authored');
        const saved = await refusal(() => save(other.protocol, CRM, 'cap_crm'));
        expect([saved?.code, saved?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
        // A package of another namespace still declares the name beside the stored set.
        engine.registry.installPackage(manifestOf(HR, [N]), 'authored');
    });

    it('a cold boot over a package\'s stored set is refused when a package of the same namespace declares the name, as before (ADR-0048 N.3)', async () => {
        const stores: Stores = new Map();
        const first = await boot(stores, [CRM]);
        expect((await save(first.protocol, CRM, 'cap_crm')).success).toBe(true);
        const error = await refusal(() => boot(stores, [CRM, CRM_TWO], undefined, { [CRM_TWO]: [N] }));
        expect(envelopeOf(error)).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422, conflicts: [environmentConflict(CRM_TWO)] });
        // CONTROL: a package of another namespace declaring the name boots beside the stored set.
        const booted = await boot(stores, [CRM, HR], undefined, { [HR]: [N] });
        expect(await grants(booted.engine, [CRM])).toEqual({ [CRM]: ['cap_crm'] });
    });

    it('a cold boot over a stored set held against a package that ships the name is refused, as before (ADR-0048 N.3)', async () => {
        const stores: Stores = new Map();
        const first = await boot(stores, [CRM, HR, CRM_CUSTOM]);
        expect((await save(first.protocol, HR, 'cap_other')).success).toBe(true);
        const rows = stores.get('sys_metadata')!;
        const [key, row] = [...rows].find(([, r]) => r.type === 'permission')!;
        rows.set(key, { ...row, package_id: CRM_CUSTOM });
        const ship = (target: ObjectQL) => target.registry.registerItem('permission', setOf('cap_crm_shipped') as any, 'name', CRM);
        const error = await refusal(() => boot(stores, [CRM, HR, CRM_CUSTOM], ship));
        expect(envelopeOf(error)).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422, conflicts: [environmentConflict(CRM)] });
    });

    it('CONTROL — a second package of the SAME namespace is still refused beside a stored set; the remedy names steps the writer can take, never an edit inside the other package', async () => {
        const stores: Stores = new Map();
        const { engine, protocol } = await boot(stores, [CRM, CRM_TWO]);
        await save(protocol, CRM, 'cap_crm');
        const error = await refusal(() => save(protocol, CRM_TWO, 'cap_crm_two'));
        expect([error?.code, error?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
        const message = String(error?.message);
        expect(message).toContain(`package "${CRM}"`);
        expect(message).toContain(`delete the set package "${CRM}" stores`);
        expect(message).not.toContain('rename it in package');
        // Nothing of crm_two's was written; crm's set is still the one served.
        expect(Array.from(stores.get('sys_metadata')?.values() ?? []).filter((r) => r.type === 'permission').map((r) => r.package_id)).toEqual([CRM]);
        expect(await grants(engine, [CRM])).toEqual({ [CRM]: ['cap_crm'] });
    });

    it('CONTROL — an install-declared name of the same namespace is still refused, and the remedy offers only the writer\'s own rename', async () => {
        const kernel = await boot(new Map(), []);
        kernel.engine.registry.installPackage(manifestOf(CRM, [N]), 'authored');
        kernel.engine.registry.installPackage(manifestOf(CRM_TWO), 'authored');
        const error = await refusal(() => save(kernel.protocol, CRM_TWO, 'cap_crm_two'));
        expect([error?.code, error?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
        const message = String(error?.message);
        expect(message).toContain(`package "${CRM}"`);
        expect(message).toContain('Rename this set to a name no other holder holds');
        expect(message).not.toContain('rename it in package');
        expect(message).not.toContain('delete the set');
    });
});
