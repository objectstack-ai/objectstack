// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29898] The metadata save doors refuse an `object` (or an
 * `object_extension`) whose field is bound to a picklist no loaded package
 * declares.
 *
 * Measured on `origin/main` before this file: an object saved with a select
 * field bound to `picklist: 'nope_list'` was stored in draft and in publish
 * mode, and `publishPackageDrafts` answered `outcome: 'published'`. The field
 * was then served with no options and the record validator refused every value
 * of it. The boot and the late-install load refuse the same shape
 * (`describeUnresolvedPicklistReferences`), and `os validate` refuses it for a
 * stack's own fields.
 *
 * Pinned here, through `saveMetaItem`, `publishMetaItem` and
 * `publishPackageDrafts` (the restore doors are pinned in
 * `protocol.restore-doors-save-refusal-family.test.ts`; the controls over a
 * real `SchemaRegistry` — a dependency's list, the base's list on a `.custom`
 * pair's extension, another installed package's list — in
 * `packages/runtime/src/domains/meta-picklist-binding-door.test.ts`):
 *  - the refusal: `422 INVALID_METADATA`, one finding per unknown binding at
 *    `fields.<field>.picklist` naming the field and the list, nothing stored
 *    (save) and nothing promoted (publish of a draft stored before the rule;
 *    the batch aborts);
 *  - a `multiselect` is judged as a `select` is;
 *  - controls: a list the registry resolves (saved, published and promoted),
 *    no binding at all, a re-save that keeps a binding the object already
 *    holds on a list gone since, the stored-metadata healing pass over a
 *    draft-only row, and a registry that cannot resolve a list.
 *
 * Each refusal is asserted by its code, its status, its path and the first
 * sentence of its finding, spelled out here.
 *
 * Harness: the stateful `sys_metadata` double of
 * `protocol.unknown-grant-object-refusal.test.ts`, kept local, with a registry
 * that answers `resolvePicklistOptions` over a mutable set of lists.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
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

const PKG = 'app.picklistprobe';

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

function makeSession(opts: { picklists?: string[]; resolvesPicklists?: boolean; objects?: string[] } = {}) {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    const picklists = new Set(opts.picklists ?? []);
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
        // The objects an `object_extension` may extend.
        getObject: (name: string) => (objects.has(name) ? { name } : undefined),
        // An installed authored base that declares no namespace.
        getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
        getArtifactItem: () => undefined,
        isPackageDisabled: () => false,
    };
    if (opts.resolvesPicklists !== false) {
        registry.resolvePicklistOptions = (name: string) =>
            (picklists.has(name) ? [{ value: 'gold', label: 'Gold' }] : undefined);
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
    return { protocol, rows, picklists };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one object, as `state|package|field:picklist,…`. */
const stored = (rows: Map<string, Row>, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === 'object' && r.name === name)
        .map((r) => {
            const fields = JSON.parse(r.metadata).fields ?? {};
            const bound = Object.entries(fields)
                .filter(([, f]: [string, any]) => typeof f?.picklist === 'string')
                .map(([k, f]: [string, any]) => `${k}:${f.picklist}`);
            return `${r.state}|${r.package_id ?? '-'}|${bound.join(',')}`;
        })
        .sort();

/** A schema-valid object body with one select field per `[field, picklist]` binding. */
const object = (name: string, bindings: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({
    name,
    label: 'Probe',
    sharingModel: 'public_read_write',
    fields: {
        name: { type: 'text', label: 'Name' },
        ...Object.fromEntries(bindings.map(([field, picklist]) => [field, { type: 'select', label: 'Tier', picklist }])),
    },
    ...extra,
});

/** Plant an object row as a row stored before the rule sits at rest. */
function plant(rows: Map<string, Row>, body: Record<string, unknown>, state: 'draft' | 'active', packageId: string | null = PKG) {
    const data = {
        type: 'object', name: String(body.name), organization_id: null, package_id: packageId,
        state, metadata: JSON.stringify(body),
    };
    rows.set(keyOf(data), { ...data, id: `planted_${state}_${String(body.name)}` });
}

/** The finding's first sentence, spelled out. */
const unknownFinding = (objectName: string, field: string, picklist: string) =>
    `Field '${objectName}.${field}' is bound to picklist '${picklist}', which no loaded package declares, `
    + 'so the field would be served with no options and every write that sets it would be refused.';

const expectRefusal = (err: any, objectName: string, bindings: Array<[string, string]>, type = 'object') => {
    expect({ code: err?.code, status: err?.status }, String(err?.stack ?? err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(String(err.message).startsWith(`${type}/${objectName} failed spec validation: `), String(err.message)).toBe(true);
    expect(err.issues.map((i: any) => i.path)).toEqual(bindings.map(([field]) => `fields.${field}.picklist`));
    for (const [index, [field, picklist]] of bindings.entries()) {
        expect(err.issues[index].code).toBe('custom');
        expect(String(err.issues[index].message).startsWith(unknownFinding(objectName, field, picklist)), err.issues[index].message).toBe(true);
    }
};

describe('[#29898] the object save door — a field bound to a picklist no loaded package declares', () => {
    it.each([
        ['a draft save into a package', { mode: 'draft', packageId: PKG }],
        ['a draft save naming no package', { mode: 'draft' }],
        ['a publish save', {}],
        ['a publish save under `force`', { force: true }],
    ])('%s is refused 422 at `fields.<field>.picklist`, naming the field and the list, and nothing is stored', async (_label, saveOpts) => {
        const { protocol, rows } = makeSession({ picklists: ['qa_tier'] });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'object', name: 'qa_probe', item: object('qa_probe', [['tier', 'qa_tier'], ['t', 'nope_list']]), ...saveOpts,
        }));

        expectRefusal(err, 'qa_probe', [['t', 'nope_list']]);
        expect(stored(rows, 'qa_probe')).toEqual([]);
    });

    it('a `multiselect` is judged as a `select` is; one finding per unknown binding, in field order', async () => {
        const { protocol } = makeSession();
        const item = object('qa_probe', [['t', 'nope_list']]);
        (item.fields as Record<string, unknown>).tags = { type: 'multiselect', label: 'Tags', picklist: 'nope_tags' };

        const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'qa_probe', item, mode: 'draft' }));

        expectRefusal(err, 'qa_probe', [['t', 'nope_list'], ['tags', 'nope_tags']]);
    });

    it('an `object_extension` field bound to an unknown list is refused the same way, naming the object it extends', async () => {
        const { protocol } = makeSession({ objects: ['qa_account'] });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'object_extension', name: 'qa_account', mode: 'draft', packageId: PKG,
            item: { extend: 'qa_account', fields: { tier: { type: 'select', label: 'Tier', picklist: 'nope_list' } } },
        }));

        expectRefusal(err, 'qa_account', [['tier', 'nope_list']], 'object_extension');
    });
});

describe('[#29898] the publish doors — an object draft stored before the rule', () => {
    it('publishMetaItem refuses it, and the draft stays a draft', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, object('qa_probe', [['t', 'nope_list']]), 'draft', null);

        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'qa_probe' }));

        expectRefusal(err, 'qa_probe', [['t', 'nope_list']]);
        expect(stored(rows, 'qa_probe')).toEqual(['draft|-|t:nope_list']);
    });

    it('publishPackageDrafts answers `refused`, names it, and promotes nothing of the batch', async () => {
        const { protocol, rows } = makeSession({ picklists: ['qa_tier'] });
        await protocol.saveMetaItem({ type: 'object', name: 'qa_good', item: object('qa_good', [['tier', 'qa_tier']]), mode: 'draft', packageId: PKG });
        plant(rows, object('qa_probe', [['t', 'nope_list']]), 'draft');

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ outcome: 'refused', success: false, publishedCount: 0, published: [] });
        const causal = res.failed.find((f: any) => f.name === 'qa_probe');
        expect(causal, JSON.stringify(res.failed)).toMatchObject({ type: 'object', code: 'INVALID_METADATA' });
        expect(JSON.stringify(causal)).toContain(unknownFinding('qa_probe', 't', 'nope_list'));
        expect(stored(rows, 'qa_probe')).toEqual([`draft|${PKG}|t:nope_list`]);
    });

    it('a list that goes between the draft save and its publish: the per-item publish is refused', async () => {
        const { protocol, rows, picklists } = makeSession({ picklists: ['qa_tier'] });
        await protocol.saveMetaItem({ type: 'object', name: 'qa_probe', item: object('qa_probe', [['tier', 'qa_tier']]), mode: 'draft' });
        picklists.delete('qa_tier');

        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'qa_probe' }));

        expectRefusal(err, 'qa_probe', [['tier', 'qa_tier']]);
        expect(stored(rows, 'qa_probe')).toEqual(['draft|-|tier:qa_tier']);
    });
});

describe('[#29898] the stored-metadata healing pass — a draft-only object stored before the rule', () => {
    it('`migrate-stored` is not judged by this door, and the draft\'s publish is still refused', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, object('qa_probe', [['t', 'nope_list']]), 'draft', null);

        await protocol.migrateStoredMetadata({ apply: true, types: ['object'] });

        expect(stored(rows, 'qa_probe')).toEqual(['draft|-|t:nope_list']);
        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'qa_probe' }));
        expectRefusal(err, 'qa_probe', [['t', 'nope_list']]);
    });

    it('an author re-saving the same draft is still refused', async () => {
        const { protocol, rows } = makeSession();
        plant(rows, object('qa_probe', [['t', 'nope_list']]), 'draft', null);

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'object', name: 'qa_probe', item: object('qa_probe', [['t', 'nope_list']], { label: 'Probe v2' }), mode: 'draft',
        }));

        expectRefusal(err, 'qa_probe', [['t', 'nope_list']]);
    });
});

describe('[#29898] controls — a binding the door does not refuse', () => {
    it.each([
        ['a list the registry resolves', [['tier', 'qa_tier']] as Array<[string, string]>],
        ['no picklist binding at all', [] as Array<[string, string]>],
    ])('%s: saves as a draft, publishes, and saves live', async (_label, bindings) => {
        const { protocol, rows } = makeSession({ picklists: ['qa_tier'] });
        await protocol.saveMetaItem({ type: 'object', name: 'qa_ok', item: object('qa_ok', bindings), mode: 'draft', packageId: PKG });
        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res.outcome, JSON.stringify(res.failed)).toBe('published');
        expect((await protocol.saveMetaItem({ type: 'object', name: 'qa_ok2', item: object('qa_ok2', bindings) })).success).toBe(true);
        expect(stored(rows, 'qa_ok')).toEqual([`active|${PKG}|${bindings.map(([f, p]) => `${f}:${p}`).join(',')}`]);
    });

    it('a re-save that keeps a binding the object already holds on a list gone since (a row stored before the rule)', async () => {
        const session = makeSession({ picklists: ['qa_tier'] });
        plant(session.rows, object('qa_old', [['t', 'qa_gone']]), 'active', null);

        const result = await session.protocol.saveMetaItem({
            type: 'object', name: 'qa_old', item: object('qa_old', [['t', 'qa_gone'], ['tier', 'qa_tier']], { label: 'Renamed' }),
        });

        expect(result.success).toBe(true);
        // …while binding another field to an unknown list is this save's binding, and refused,
        // and so is re-binding the held field to a different unknown list.
        const err = await refusalOf(session.protocol.saveMetaItem({
            type: 'object', name: 'qa_old', item: object('qa_old', [['t', 'qa_gone'], ['tier', 'qa_tier'], ['u', 'qa_typo']]),
        }));
        expectRefusal(err, 'qa_old', [['u', 'qa_typo']]);
        const rebound = await refusalOf(session.protocol.saveMetaItem({
            type: 'object', name: 'qa_old', item: object('qa_old', [['t', 'qa_typo'], ['tier', 'qa_tier']]), force: true,
        }));
        expectRefusal(rebound, 'qa_old', [['t', 'qa_typo']]);
    });

    it('a registry that cannot resolve a list refuses nothing', async () => {
        const { protocol, rows } = makeSession({ resolvesPicklists: false });
        expect((await protocol.saveMetaItem({ type: 'object', name: 'qa_probe', item: object('qa_probe', [['t', 'nope_list']]) })).success).toBe(true);
        expect(stored(rows, 'qa_probe')).toEqual(['active|-|t:nope_list']);
    });
});
