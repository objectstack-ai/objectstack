// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26724] The metadata save doors refuse an `object` whose `datasource` names
 * a datasource that does not exist here.
 *
 * Measured on `origin/main` `96e7a433` before this file: an object saved with
 * `datasource: 'gapdata_nosuch'` was stored in draft and in publish mode, and
 * `publishPackageDrafts` answered `outcome: 'published'`. The engine routes an
 * explicit `datasource` to the driver of that name only, so the object then
 * never registered and every data call on it answered 404 "not registered".
 *
 * Pinned here, through `saveMetaItem`, `publishMetaItem` and
 * `publishPackageDrafts`:
 *  - the refusal: `422 INVALID_METADATA`, one finding at `datasource` naming
 *    the datasource, nothing stored (save) and nothing promoted (publish of a
 *    draft stored before the rule; the batch aborts);
 *  - the per-item publish of an object draft whose datasource is still only a
 *    draft is refused: the object would go live without it;
 *  - controls, each saved, published and promoted: no `datasource`,
 *    `'default'`, a driver registered on the engine with no datasource item, a
 *    datasource the code layer registers, a stored datasource, a datasource
 *    drafted in the same package and published in the same batch (promoted
 *    after the object), and a re-save that keeps the binding the object
 *    already holds; an engine that cannot name its drivers refuses nothing.
 *
 * Each refusal is asserted by its code, its status, its path and the first
 * sentence of its finding, spelled out here.
 *
 * Harness: the stateful `sys_metadata` double of
 * `protocol-publish-drafts-object-field-refs.test.ts`, kept local, plus the
 * engine's `getDriverByName` over a mutable driver set and a registry that
 * answers code-layer datasources.
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

const PKG = 'app.gapdata';

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

function makeSession(opts: {
    drivers?: string[];
    registryDatasources?: Record<string, Record<string, unknown>>;
    namesDrivers?: boolean;
} = {}) {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    const drivers = new Set(opts.drivers ?? []);
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
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
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: (type: string, name: string) =>
                type === 'datasource' ? opts.registryDatasources?.[name] : undefined,
            getAllObjects: () => [],
            // An installed authored base that declares no namespace.
            getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    if (opts.namesDrivers !== false) {
        engine.getDriverByName = (name: string) => (drivers.has(name) ? { name } : undefined);
    }
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, drivers };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one item, as `state|package|datasource`. */
const stored = (rows: Map<string, Row>, type: string, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === type && r.name === name)
        .map((r) => `${r.state}|${r.package_id ?? '-'}|${JSON.parse(r.metadata).datasource ?? '-'}`)
        .sort();

/** A schema-valid object body; `datasource` omitted when `undefined`. */
const object = (name: string, datasource?: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: 'Bad DS',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
    ...(datasource !== undefined ? { datasource } : {}),
    ...extra,
});

/** A schema-valid datasource body. */
const datasource = (name: string) => ({ name, label: 'Lake', driver: 'sqlite', config: { filename: `${name}.db` } });

/** Plant an object draft as a draft stored before the rule sits at rest. */
function plantDraft(rows: Map<string, Row>, body: Record<string, unknown>, packageId: string | null = PKG) {
    const data = {
        type: 'object', name: String(body.name), organization_id: null, package_id: packageId,
        state: 'draft', metadata: JSON.stringify(body),
    };
    rows.set(keyOf(data), { ...data, id: `planted_${String(body.name)}` });
}

/** The finding's first sentence, spelled out. */
const unknownFinding = (objectName: string, ds: string) =>
    `Object '${objectName}' names datasource '${ds}', and no datasource of that name exists here: `
    + 'none is declared (a `*.datasource.ts` or a saved `datasource`) and no driver is registered under it.';

const expectRefusal = (err: any, objectName: string, ds: string) => {
    expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(String(err.message).startsWith(`object/${objectName} failed spec validation: `), String(err.message)).toBe(true);
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toMatchObject({ path: 'datasource', code: 'custom' });
    expect(String(err.issues[0].message).startsWith(unknownFinding(objectName, ds)), err.issues[0].message).toBe(true);
};

describe('[#26724] the object save door — a `datasource` that names nothing', () => {
    it.each([
        ['a draft save into a package', { mode: 'draft', packageId: PKG }],
        ['a draft save naming no package', { mode: 'draft' }],
        ['a publish save', {}],
        ['a publish save under `force`', { force: true }],
    ])('%s is refused 422 at `datasource`, naming it, and nothing is stored', async (_label, saveOpts) => {
        const { protocol, rows } = makeSession({ drivers: ['default'] });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'object', name: 'gapdata_badds', item: object('gapdata_badds', 'gapdata_nosuch'), ...saveOpts,
        }));

        expectRefusal(err, 'gapdata_badds', 'gapdata_nosuch');
        expect(stored(rows, 'object', 'gapdata_badds')).toEqual([]);
    });

    it('a draft save does not count a datasource draft that is gone by its publish: the per-item publish is refused', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'lake', item: datasource('lake'), mode: 'draft' });
        await protocol.saveMetaItem({ type: 'object', name: 'lake_item', item: object('lake_item', 'lake'), mode: 'draft' });

        // The object alone goes live; its datasource stays a draft.
        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'lake_item' }));

        expectRefusal(err, 'lake_item', 'lake');
        expect(stored(rows, 'object', 'lake_item')).toEqual(['draft|-|lake']);
    });
});

describe('[#26724] the publish doors — a draft stored before the rule', () => {
    it('publishMetaItem refuses it, and the draft stays a draft', async () => {
        const { protocol, rows } = makeSession();
        plantDraft(rows, object('gapdata_badds', 'nope_ds_2'), null);

        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'gapdata_badds' }));

        expectRefusal(err, 'gapdata_badds', 'nope_ds_2');
        expect(stored(rows, 'object', 'gapdata_badds')).toEqual(['draft|-|nope_ds_2']);
    });

    it('publishPackageDrafts answers `refused`, names it, and promotes nothing of the batch', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'gapdata_good', item: object('gapdata_good'), mode: 'draft', packageId: PKG });
        plantDraft(rows, object('gapdata_badds', 'gapdata_nosuch'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ outcome: 'refused', success: false, publishedCount: 0, published: [] });
        const causal = res.failed.find((f: any) => f.name === 'gapdata_badds');
        expect(causal, JSON.stringify(res.failed)).toMatchObject({ type: 'object', code: 'INVALID_METADATA' });
        expect(JSON.stringify(causal)).toContain("names datasource 'gapdata_nosuch'");
        // (The double's `transaction` does not roll back, so the sibling's
        // promotion is not read here: `publishedCount: 0` is the batch's word.)
        expect(stored(rows, 'object', 'gapdata_badds')).toEqual([`draft|${PKG}|gapdata_nosuch`]);
    });
});

describe('[#26724] controls — a datasource that exists is not refused', () => {
    it.each([
        ['no `datasource`', undefined],
        ["`datasource: 'default'`", 'default'],
    ])('%s: saves as a draft, publishes, and saves live', async (_label, ds) => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'gapdata_ok', item: object('gapdata_ok', ds), mode: 'draft', packageId: PKG });
        expect((await protocol.publishPackageDrafts({ packageId: PKG })).outcome).toBe('published');
        expect((await protocol.saveMetaItem({ type: 'object', name: 'gapdata_ok2', item: object('gapdata_ok2', ds) })).success).toBe(true);
        expect(stored(rows, 'object', 'gapdata_ok')).toEqual([`active|${PKG}|${ds ?? '-'}`]);
    });

    it('a driver registered on the engine with no datasource item (a run-time registration)', async () => {
        const { protocol, rows } = makeSession({ drivers: ['rt_store'] });
        await protocol.saveMetaItem({ type: 'object', name: 'rt_item', item: object('rt_item', 'rt_store'), mode: 'draft', packageId: PKG });
        expect((await protocol.publishPackageDrafts({ packageId: PKG })).outcome).toBe('published');
        expect((await protocol.saveMetaItem({ type: 'object', name: 'rt_item2', item: object('rt_item2', 'rt_store') })).success).toBe(true);
        expect(stored(rows, 'object', 'rt_item')).toEqual([`active|${PKG}|rt_store`]);
    });

    it('a datasource the code layer registers, whether or not its driver is connected', async () => {
        const { protocol, rows } = makeSession({ registryDatasources: { lake: datasource('lake') } });
        await protocol.saveMetaItem({ type: 'object', name: 'lake_item', item: object('lake_item', 'lake'), mode: 'draft', packageId: PKG });
        expect((await protocol.publishPackageDrafts({ packageId: PKG })).outcome).toBe('published');
        expect(stored(rows, 'object', 'lake_item')).toEqual([`active|${PKG}|lake`]);
    });

    it('a datasource stored in this environment', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'lake', item: datasource('lake') });
        await protocol.saveMetaItem({ type: 'object', name: 'lake_item', item: object('lake_item', 'lake'), mode: 'draft' });
        expect((await protocol.publishMetaItem({ type: 'object', name: 'lake_item' })).success).toBe(true);
        expect(stored(rows, 'object', 'lake_item')).toEqual(['active|-|lake']);
    });

    it('a datasource drafted in the same package publishes with the object, even promoted after it', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'lake', item: datasource('lake'), mode: 'draft', packageId: PKG });
        await protocol.saveMetaItem({ type: 'object', name: 'lake_item', item: object('lake_item', 'lake'), mode: 'draft', packageId: PKG });
        // Re-saving the datasource draft lists it after the object, so the
        // batch promotes the object first, while the datasource is a draft.
        await protocol.saveMetaItem({ type: 'datasource', name: 'lake', item: { ...datasource('lake'), label: 'Lake v2' }, mode: 'draft', packageId: PKG });
        const order = (await protocol.listDrafts({ packageId: PKG })).drafts.map((d: any) => `${d.type}/${d.name}`);
        expect(order).toEqual(['object/lake_item', 'datasource/lake']);

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res, JSON.stringify(res.failed)).toMatchObject({ outcome: 'published', publishedCount: 2 });
        expect(stored(rows, 'object', 'lake_item')).toEqual([`active|${PKG}|lake`]);
    });

    it('a re-save that keeps the binding the object already holds (a row stored before the rule)', async () => {
        const { protocol, rows } = makeSession();
        const data = {
            type: 'object', name: 'gapdata_old', organization_id: null, package_id: null,
            state: 'active', metadata: JSON.stringify(object('gapdata_old', 'gapdata_gone')),
        };
        rows.set(keyOf(data), { ...data, id: 'planted_active' });

        const result = await protocol.saveMetaItem({ type: 'object', name: 'gapdata_old', item: object('gapdata_old', 'gapdata_gone', { label: 'Renamed' }) });

        expect(result.success).toBe(true);
        // …while moving it to another unknown name is this save's binding, and refused.
        const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'gapdata_old', item: object('gapdata_old', 'gapdata_typo') }));
        expectRefusal(err, 'gapdata_old', 'gapdata_typo');
    });

    it('an engine that cannot name its registered drivers refuses nothing', async () => {
        const { protocol, rows } = makeSession({ namesDrivers: false });
        expect((await protocol.saveMetaItem({ type: 'object', name: 'gapdata_badds', item: object('gapdata_badds', 'gapdata_nosuch') })).success).toBe(true);
        expect(stored(rows, 'object', 'gapdata_badds')).toEqual(['active|-|gapdata_nosuch']);
    });
});
