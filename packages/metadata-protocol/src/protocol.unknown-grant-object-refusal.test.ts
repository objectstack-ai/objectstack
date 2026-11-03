// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28990] The metadata save doors refuse a `permission` set whose `objects`
 * map grants on an object that does not exist here.
 *
 * Measured on `origin/main` before this file: a permission set saved with a
 * grant keyed `qa_no_such_object` was stored in draft and in publish mode, and
 * `publishPackageDrafts` answered `outcome: 'published'`. The permission
 * evaluator keys a grant by the object's name, so the grant applied to
 * nothing. `defineStack` refuses the same grant at build
 * (`collectPermissionGrantObjectErrors`, #18202).
 *
 * Pinned here, through `saveMetaItem`, `publishMetaItem` and
 * `publishPackageDrafts` (the restore doors are pinned in
 * `protocol.restore-doors-save-refusal-family.test.ts`):
 *  - the refusal: `422 INVALID_METADATA`, one finding per unknown object at
 *    `objects.<name>` naming it, nothing stored (save) and nothing promoted
 *    (publish of a draft stored before the rule; the batch aborts);
 *  - the per-item publish of a set draft whose object is still only a draft
 *    is refused: the set would go live granting on nothing;
 *  - controls, each saved, published and promoted: a registered object, a
 *    platform object (an RBAC link table), the `'*'` wildcard, an object
 *    stored in this environment, an object drafted in the same package and
 *    published in the same batch (promoted after the set), and a re-save
 *    that keeps a grant the set already holds; a registry that cannot look
 *    an object up refuses nothing.
 *
 * Each refusal is asserted by its code, its status, its path and the first
 * sentence of its finding, spelled out here.
 *
 * Harness: the stateful `sys_metadata` double of
 * `protocol.unknown-datasource-refusal.test.ts`, kept local, with a registry
 * that answers `getObject` over a mutable set of registered objects.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const PKG = 'app.grantprobe';

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + `$in` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        const actual = (r as unknown as Record<string, unknown>)[k];
        if (v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            if (!(v as { $in: unknown[] }).$in.includes(actual)) return false;
            continue;
        }
        if (v === null ? actual !== null && actual !== undefined : actual !== v) return false;
    }
    return true;
}

function makeSession(opts: { objects?: string[]; looksUpObjects?: boolean } = {}) {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    const objects = new Set(opts.objects ?? []);
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const registry: any = {
        registerItem: () => {},
        registerObject: () => {},
        listItems: () => [],
        getItem: () => undefined,
        getAllObjects: () => [],
        // An installed authored base that declares no namespace.
        getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
        getArtifactItem: () => undefined,
        isPackageDisabled: () => false,
    };
    if (opts.looksUpObjects !== false) {
        registry.getObject = (name: string) => (objects.has(name) ? { name } : undefined);
    }
    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') {
                return history.find((h) => Object.entries(o.where).every(([k, v]) => {
                    if (k.startsWith('$')) throw new Error(`history double: unsupported operator ${k}`);
                    return v === undefined || h[k] === v;
                })) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            const matched = Array.from(rows.values()).filter((r) => matchesWhere(r, o?.where ?? {}));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata_history') {
                history.push({ ...data, id: `h_${nextId}` });
                return { id: `h_${nextId}` };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(o);
            const found = findRow(o.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, objects };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one item, as `state|package|grant keys`. */
const stored = (rows: Map<string, Row>, type: string, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === type && r.name === name)
        .map((r) => `${r.state}|${r.package_id ?? '-'}|${Object.keys(JSON.parse(r.metadata).objects ?? {}).join(',')}`)
        .sort();

/** A schema-valid permission-set body granting read on each named object. */
const set = (name: string, objectNames: string[], extra: Record<string, unknown> = {}) => ({
    name,
    label: 'Grant probe',
    objects: Object.fromEntries(objectNames.map((o) => [o, { allowRead: true }])),
    ...extra,
});

/** A schema-valid object body. */
const object = (name: string) => ({
    name,
    label: 'Widget',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
});

/** Plant a row as a row stored before the rule sits at rest. */
function plant(rows: Map<string, Row>, body: Record<string, unknown>, state: 'draft' | 'active', packageId: string | null = PKG) {
    const data = {
        type: 'permission', name: String(body.name), organization_id: null, package_id: packageId,
        state, metadata: JSON.stringify(body),
    };
    rows.set(keyOf(data), { ...data, id: `planted_${state}_${String(body.name)}` });
}

/**
 * The finding's first sentence, spelled out. [#29279] A draft's publish says
 * what it looked for there: a published object or an object draft of its
 * batch, not an object "saved here" (a draft of it may be saved here).
 */
const unknownFinding = (setName: string, objectName: string, door: 'save' | 'publish' = 'save') =>
    `Permission '${setName}' grants on object '${objectName}' which is not defined in objects: no package registers `
    + (door === 'publish'
        ? 'an object of that name, and no published object, or object draft of this batch, carries it'
        : 'an object of that name and none is saved here')
    + ', so the grant applies to nothing.';

const expectRefusal = (err: any, setName: string, objectNames: string[], door: 'save' | 'publish' = 'save') => {
    expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(String(err.message).startsWith(`permission/${setName} failed spec validation: `), String(err.message)).toBe(true);
    expect(err.issues.map((i: any) => i.path)).toEqual(objectNames.map((o) => `objects.${o}`));
    for (const [index, objectName] of objectNames.entries()) {
        expect(err.issues[index].code).toBe('custom');
        expect(String(err.issues[index].message).startsWith(unknownFinding(setName, objectName, door)), err.issues[index].message).toBe(true);
    }
};

describe('[#28990] the permission-set save door — a grant on an object that does not exist', () => {
    it.each([
        ['a draft save into a package', { mode: 'draft', packageId: PKG }],
        ['a draft save naming no package', { mode: 'draft' }],
        ['a publish save', {}],
        ['a publish save under `force`', { force: true }],
    ])('%s is refused 422 at `objects.<name>`, naming it, and nothing is stored', async (_label, saveOpts) => {
        const { protocol, rows } = makeSession({ objects: ['qa_widget'] });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'permission', name: 'qa_probe', item: set('qa_probe', ['qa_widget', 'qa_no_such_object']), ...saveOpts,
        }));

        expectRefusal(err, 'qa_probe', ['qa_no_such_object']);
        expect(stored(rows, 'permission', 'qa_probe')).toEqual([]);
    });

    it('one finding per unknown object, in the order the set names them; a short name is not the object', async () => {
        const { protocol } = makeSession({ objects: ['crm_lead'] });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'permission', name: 'qa_probe', item: set('qa_probe', ['lead', 'crm_lead', 'qa_no_such_object']),
        }));

        expectRefusal(err, 'qa_probe', ['lead', 'qa_no_such_object']);
    });

    it('a draft save does not count an object draft that is gone by its publish: the per-item publish is refused', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'qa_widget', item: object('qa_widget'), mode: 'draft' });
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_probe', item: set('qa_probe', ['qa_widget']), mode: 'draft' });

        // The set alone goes live; its object stays a draft.
        const err = await refusalOf(protocol.publishMetaItem({ type: 'permission', name: 'qa_probe' }));

        expectRefusal(err, 'qa_probe', ['qa_widget'], 'publish');
        expect(stored(rows, 'permission', 'qa_probe')).toEqual(['draft|-|qa_widget']);
    });
});

describe('[#28990] the publish doors — a set draft stored before the rule', () => {
    it('publishMetaItem refuses it, and the draft stays a draft', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, set('qa_probe', ['qa_no_such_object']), 'draft', null);

        const err = await refusalOf(protocol.publishMetaItem({ type: 'permission', name: 'qa_probe' }));

        expectRefusal(err, 'qa_probe', ['qa_no_such_object'], 'publish');
        expect(stored(rows, 'permission', 'qa_probe')).toEqual(['draft|-|qa_no_such_object']);
    });

    it('publishPackageDrafts answers `refused`, names it, and promotes nothing of the batch', async () => {
        const { protocol, rows } = makeSession({ objects: ['qa_widget'] });
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_good', item: set('qa_good', ['qa_widget']), mode: 'draft', packageId: PKG });
        plant(rows, set('qa_probe', ['qa_no_such_object']), 'draft');

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ outcome: 'refused', success: false, publishedCount: 0, published: [] });
        const causal = res.failed.find((f: any) => f.name === 'qa_probe');
        expect(causal, JSON.stringify(res.failed)).toMatchObject({ type: 'permission', code: 'INVALID_METADATA' });
        expect(JSON.stringify(causal)).toContain(unknownFinding('qa_probe', 'qa_no_such_object', 'publish'));
        // (The double's `transaction` does not roll back, so the sibling's
        // promotion is not read here: `publishedCount: 0` is the batch's word.)
        expect(stored(rows, 'permission', 'qa_probe')).toEqual([`draft|${PKG}|qa_no_such_object`]);
    });
});

describe('[#29279] the stored-metadata healing pass — a draft-only set stored before the rule', () => {
    it('`migrate-stored` rewrites it (a legacy key stripped), and its publish is still refused', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, set('qa_probe', ['qa_no_such_object'], { managedBy: 'user' }), 'draft', null);

        const report = await protocol.migrateStoredMetadata({ apply: true, types: ['permission'] });

        const row = report.rows.find((r: any) => r.name === 'qa_probe');
        expect(row, JSON.stringify(row)).toMatchObject({ state: 'draft', outcome: 'rewritten' });
        const bodies = [...rows.values()].filter((r) => r.type === 'permission').map((r) => JSON.parse(r.metadata));
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).not.toHaveProperty('managedBy');
        expect(stored(rows, 'permission', 'qa_probe')).toEqual(['draft|-|qa_no_such_object']);
        const err = await refusalOf(protocol.publishMetaItem({ type: 'permission', name: 'qa_probe' }));
        expectRefusal(err, 'qa_probe', ['qa_no_such_object'], 'publish');
    });

    it('an author re-saving the same draft is still refused', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, set('qa_probe', ['qa_no_such_object'], { managedBy: 'user' }), 'draft', null);

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'permission', name: 'qa_probe', item: set('qa_probe', ['qa_no_such_object']), mode: 'draft',
        }));

        expectRefusal(err, 'qa_probe', ['qa_no_such_object']);
    });
});

describe('[#28990] controls — a grant on an object that exists is not refused', () => {
    it.each([
        ['an object the registry registers', ['qa_widget']],
        ['a platform object (an RBAC link table)', ['sys_user_position']],
        ["the `'*'` wildcard", ['*']],
        ['no grant at all', []],
    ])('%s: saves as a draft, publishes, and saves live', async (_label, grants) => {
        const { protocol, rows } = makeSession({ objects: ['qa_widget', 'sys_user_position'] });
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_ok', item: set('qa_ok', grants), mode: 'draft', packageId: PKG });
        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res.outcome, JSON.stringify(res.failed)).toBe('published');
        expect((await protocol.saveMetaItem({ type: 'permission', name: 'qa_ok2', item: set('qa_ok2', grants) })).success).toBe(true);
        expect(stored(rows, 'permission', 'qa_ok')).toEqual([`active|${PKG}|${grants.join(',')}`]);
    });

    it('an object stored in this environment that the registry has not registered', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'qa_widget', item: object('qa_widget') });
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_ok', item: set('qa_ok', ['qa_widget']), mode: 'draft' });
        expect((await protocol.publishMetaItem({ type: 'permission', name: 'qa_ok' })).success).toBe(true);
        expect(stored(rows, 'permission', 'qa_ok')).toEqual(['active|-|qa_widget']);
    });

    it('an object drafted in the same package publishes with the set, even promoted after it', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'qa_widget', item: object('qa_widget'), mode: 'draft', packageId: PKG });
        await protocol.saveMetaItem({ type: 'permission', name: 'qa_ok', item: set('qa_ok', ['qa_widget']), mode: 'draft', packageId: PKG });
        // Re-saving the object draft lists it after the set, so the batch
        // promotes the set first, while the object is a draft.
        await protocol.saveMetaItem({ type: 'object', name: 'qa_widget', item: { ...object('qa_widget'), label: 'Widget v2' }, mode: 'draft', packageId: PKG });
        const order = (await protocol.listDrafts({ packageId: PKG })).drafts.map((d: any) => `${d.type}/${d.name}`);
        expect(order).toEqual(['permission/qa_ok', 'object/qa_widget']);

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res, JSON.stringify(res.failed)).toMatchObject({ outcome: 'published', publishedCount: 2 });
        expect(stored(rows, 'permission', 'qa_ok')).toEqual([`active|${PKG}|qa_widget`]);
    });

    it('a re-save that keeps a grant the set already holds on an object gone since (a row stored before the rule)', async () => {
        const { protocol, rows } = makeSession({ objects: ['qa_widget'] });
        plant(rows, set('qa_old', ['qa_gone']), 'active', null);

        const result = await protocol.saveMetaItem({
            type: 'permission', name: 'qa_old', item: set('qa_old', ['qa_gone', 'qa_widget'], { label: 'Renamed' }),
        });

        expect(result.success).toBe(true);
        // …while adding another unknown object is this save's grant, and refused.
        const err = await refusalOf(protocol.saveMetaItem({
            type: 'permission', name: 'qa_old', item: set('qa_old', ['qa_gone', 'qa_typo']),
        }));
        expectRefusal(err, 'qa_old', ['qa_typo']);
    });

    it('a registry that cannot look an object up refuses nothing', async () => {
        const { protocol, rows } = makeSession({ looksUpObjects: false });
        expect((await protocol.saveMetaItem({ type: 'permission', name: 'qa_probe', item: set('qa_probe', ['qa_no_such_object']) })).success).toBe(true);
        expect(stored(rows, 'permission', 'qa_probe')).toEqual(['active|-|qa_no_such_object']);
    });
});
