// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30319] The two doors that copy a permission set into a new package, on a
 * deployment without an optional plugin whose object a platform set grants on
 * (`sys_comment`, which `@objectstack/plugin-audit` registers).
 *
 * Measured on `origin/main` (870ebce3) before this file, on the harness below:
 *  - `duplicatePackage` answered `success: false`, the object copied and the
 *    set in `failed[]` with the unknown-object refusal at
 *    `objects.sys_comment` — the same 422 the permission-set clone door had
 *    (#30255, fixed by PR #30310 through `inheritedGrantObjects`);
 *  - `importUnmanagedPackage` answered `422 INVALID_METADATA` at
 *    `objects.sys_comment` and rolled the whole import back.
 *
 * Pinned here:
 *  - the DUPLICATE door copies a stored set's grants the source row holds:
 *    the copy is saved, granting on `sys_comment`. Keys come from the stored
 *    row, never the request. A key the copy's rewrite renames (the source's
 *    own namespace) is not the source's, so a renamed grant on an object that
 *    does not exist is still refused — and only that one;
 *  - the UNMANAGED IMPORT keeps refusing, by ruling (seat 2 on #30319, option
 *    A): the package is the request's body, not a stored row, so its sets are
 *    new writes and every grant is judged (triage 6651966154: the inherited
 *    keys are derived from the source set as stored, never from request input).
 *
 * Harness: a stateful `sys_metadata` stub and a registry that keeps packages
 * and namespaces, after `package-unmanaged-install.test.ts`. The registry
 * registers no object, so an object is known only when it is stored here.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

type Row = Record<string, any>;

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key === '$or') {
            if (!(want as Array<Record<string, unknown>>).some((c) => matches(row, c))) return false;
            continue;
        }
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported operator ${key}`);
        const have = row[key] ?? null;
        if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
            const ops = Object.keys(want);
            if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`stub engine: unsupported operator ${ops.join(',')}`);
            if (!(want as { $in: unknown[] }).$in.includes(have)) return false;
            continue;
        }
        if (have !== want) return false;
    }
    return true;
}

function makeProtocol(seed: Row[] = [], seedPackages: any[] = []) {
    const tables = new Map<string, Row[]>([['sys_metadata', seed.map((r) => ({ ...r }))]]);
    const table = (name: string) => {
        if (!tables.has(name)) tables.set(name, []);
        return tables.get(name)!;
    };
    let nextId = 0;
    const packages = new Map<string, any>(seedPackages.map((m) => [m.id, { manifest: m, status: 'installed', enabled: true }]));
    const namespaces = new Map<string, Set<string>>();
    for (const m of seedPackages) if (m.namespace) namespaces.set(m.namespace, new Set([m.id]));
    const engine: any = {
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        async find(t: string, q?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = table(t).filter((r) => matches(r, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        async findOne(t: string, q: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, q);
            return table(t).find((r) => matches(r, q.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...data };
            table(t).push(row);
            return { ...row };
        },
        async update(t: string, data: Row, q?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, q);
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const hit = table(t).filter((r) => matches(r, where));
            for (const r of hit) Object.assign(r, data);
            return { id: hit[0]?.id ?? null };
        },
        async delete(t: string, q?: Record<string, unknown>) {
            assertEngineDeleteDispatch(q);
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const keep = table(t).filter((r) => !matches(r, where));
            const deleted = table(t).length - keep.length;
            tables.set(t, keep);
            return { deleted };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getAllObjects: () => [],
            // No plugin-audit: `sys_comment` is registered by nothing here.
            getObject: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            getPackage: (id: string) => packages.get(id),
            installPackage: (manifest: any) => {
                const pkg = { manifest, status: 'installed', enabled: true };
                packages.set(manifest.id, pkg);
                if (manifest.namespace) {
                    if (!namespaces.has(manifest.namespace)) namespaces.set(manifest.namespace, new Set());
                    namespaces.get(manifest.namespace)!.add(manifest.id);
                }
                return pkg;
            },
            uninstallPackage: (id: string) => {
                const pkg = packages.get(id);
                packages.delete(id);
                if (pkg?.manifest?.namespace) namespaces.get(pkg.manifest.namespace)?.delete(id);
            },
            unregisterNamespace: () => {},
            getNamespaceOwners: (ns: string) => [...(namespaces.get(ns) ?? [])],
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, table, packages };
}

const SOURCE = 'com.example.leave';
const TARGET = 'com.example.leave-copy';
const SOURCE_MANIFEST = { id: SOURCE, name: 'Leave', type: 'app', namespace: 'leave', version: '1.0.0' };

const ticket = {
    name: 'leave_ticket', label: 'Ticket', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } },
};
/** A schema-valid permission-set body granting read on each named object. */
const set = (name: string, objectNames: string[]) => ({
    name,
    label: 'Leave staff',
    objects: Object.fromEntries(objectNames.map((o) => [o, { allowRead: true }])),
});
/** A row of the source package as it sits at rest. */
const sourceRow = (type: string, body: { name: string }) => ({
    type, name: body.name, organization_id: null, package_id: SOURCE, state: 'active', metadata: JSON.stringify(body),
});

/** The finding's first sentence, spelled out (`unknownGrantObjectSaveRefusal`). */
const unknownFinding = (setName: string, objectName: string) =>
    `Permission '${setName}' grants on object '${objectName}' which is not defined in objects: no package registers `
    + 'an object of that name and none is saved here, so the grant applies to nothing.';

/** The stored grant keys of one permission set of the target package. */
const copiedGrants = (rows: Row[], name: string) =>
    rows.filter((r) => r.type === 'permission' && r.name === name && r.package_id === TARGET)
        .map((r) => Object.keys(JSON.parse(r.metadata).objects ?? {}));

describe('[#30319] duplicatePackage — a copied permission set keeps the grants its source row holds', () => {
    it('a set granting on an optional plugin\'s object not installed here is copied, the grant with it', async () => {
        const { protocol, table } = makeProtocol(
            [sourceRow('object', ticket), sourceRow('permission', set('leave_staff', ['leave_ticket', 'sys_comment']))],
            [SOURCE_MANIFEST],
        );

        const res = await protocol.duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(res.copied).toEqual([
            { type: 'object', name: 'leave_copy_ticket' },
            { type: 'permission', name: 'leave_copy_staff' },
        ]);
        // The source's own object is rewritten to the copy's; the platform grant is kept.
        expect(copiedGrants(table('sys_metadata'), 'leave_copy_staff')).toEqual([['leave_copy_ticket', 'sys_comment']]);
    });

    it('a grant the copy renames onto an object that does not exist is still refused — that grant alone', async () => {
        // The copy's rewrite renames a grant on the source's own object to the
        // copy's (`leave_ticket` → `leave_copy_ticket`): a key the source never
        // held. Here that object's row does not copy (unparseable), so the
        // renamed grant names nothing and is judged; `sys_comment` is not.
        const { protocol, table } = makeProtocol(
            [
                { ...sourceRow('object', ticket), metadata: '{not json' },
                sourceRow('permission', set('leave_staff', ['leave_ticket', 'sys_comment'])),
            ],
            [SOURCE_MANIFEST],
        );

        const res = await protocol.duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        expect(res.success).toBe(false);
        expect(res.copied).toEqual([]);
        expect(res.failed).toEqual([
            { type: 'object', name: 'leave_ticket', error: 'unparseable metadata' },
            {
                type: 'permission',
                name: 'leave_staff',
                error: 'permission/leave_copy_staff failed spec validation: objects.leave_copy_ticket: '
                    + `${unknownFinding('leave_copy_staff', 'leave_copy_ticket')} `
                    + "Correct the name to the object's full name (e.g. 'crm_lead', not 'lead'), create the object first, or remove the grant.",
            },
        ]);
        expect(copiedGrants(table('sys_metadata'), 'leave_copy_staff')).toEqual([]);
    });

    it('a grant the source holds on an object outside its namespace that does not exist is the source\'s, and is copied', async () => {
        // Not renamed (no object row of the source carries it), so it is the
        // source's grant as stored — the clone door's rule for a copy.
        const { protocol, table } = makeProtocol(
            [sourceRow('object', ticket), sourceRow('permission', set('leave_staff', ['leave_ticket', 'other_gone']))],
            [SOURCE_MANIFEST],
        );

        const res = await protocol.duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        expect(res.failed).toEqual([]);
        expect(copiedGrants(table('sys_metadata'), 'leave_copy_staff')).toEqual([['leave_copy_ticket', 'other_gone']]);
    });
});

describe('[#30319] importUnmanagedPackage — the package is the request\'s body, so every grant is judged', () => {
    it('a set granting on an object not installed here is refused 422 at `objects.<name>`, and the import is rolled back', async () => {
        // By ruling (seat 2 on #30319, option A): no `inheritedGrantObjects`
        // here. Deriving them from the body would be reading request input,
        // which turns the unknown-object refusal off for this door.
        const { protocol, table, packages } = makeProtocol();

        let err: any;
        try {
            await protocol.importUnmanagedPackage({
                manifest: {
                    id: 'com.example.crm', namespace: 'crm', version: '4.0.0', type: 'app', name: 'CRM',
                    objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
                    permissions: [set('crm_rep', ['crm_lead', 'sys_comment'])],
                },
            });
        } catch (e) {
            err = e;
        }

        expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.path)).toEqual(['objects.sys_comment']);
        expect(String(err.issues[0].message).startsWith(unknownFinding('crm_rep', 'sys_comment')), err.issues[0].message).toBe(true);
        // Rolled back whole: no row, no base.
        expect(table('sys_metadata')).toEqual([]);
        expect(packages.has('com.example.crm-copy')).toBe(false);
    });
});
