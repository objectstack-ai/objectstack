// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §4.2 · #25211] The metadata save doors refuse an `external` object
 * binding on a NAMED datasource this environment holds as managed, from both
 * sides of the pair.
 *
 * ADR-0015 §4.2 allows `object.external` only on a datasource whose
 * `schemaMode` is not `'managed'` (an absent `schemaMode` is the spec default,
 * `'managed'`). #25168 judged the half the object shows alone (a binding on
 * `'default'`, in `ObjectSchema`'s parse) and the half a stack shows
 * (`defineStack`). Measured before this file, on the save door: an object saved
 * `external` on a stored managed `wh` was stored, in draft and publish mode and
 * under `force`; and `wh` re-saved as managed (or with no `schemaMode`) under a
 * stored object bound to it with `external` was stored too.
 *
 * Pinned here, all through `saveMetaItem` / `publishMetaItem`:
 *  - the object half: `422 INVALID_METADATA`, the finding at `external`,
 *    nothing stored — against a stored datasource row and a registered one;
 *  - the datasource half: `422 INVALID_METADATA`, one finding per bound object
 *    at `schemaMode`, the stored row unchanged — against stored object rows and
 *    registered objects no stored row overlays;
 *  - the publish of a draft is judged again, against the other half as it
 *    stands at publish;
 *  - controls: a federated datasource, a datasource no layer holds, an object
 *    without `external`, a binding on another datasource.
 *
 * Each refusal is asserted by its code, its status and the first sentence of
 * its finding, spelled out here, never read back from the predicate under test.
 *
 * Harness: the real write path over a stateful `sys_metadata` double, the shape
 * of `protocol.code-defined-datasource-door.test.ts`.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses. From `@objectstack/metadata-core`,
// not `@objectstack/objectql`, which depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    state: string;
    metadata: string;
    [key: string]: unknown;
}

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
        return whereValueMatches(row[k], v);
    });

/**
 * One kernel. `registryDatasources` are datasource definitions the code layer
 * registers (the registry's `getItem` answers them); `registryObjects` are the
 * objects the registry holds (`getAllObjects`), as a package ships them.
 */
function makeSession(opts: {
    registryDatasources?: Record<string, Record<string, unknown>>;
    registryObjects?: Array<Record<string, unknown>>;
} = {}) {
    const rows = new Map<string, Row>();
    const historyRows: Array<Record<string, unknown>> = [];
    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            if (table !== 'sys_metadata') return null;
            for (const row of rows.values()) if (matchesWhere(row, o.where)) return row;
            return null;
        },
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            const matched = Array.from(rows.values()).filter((row) => matchesWhere(row, o?.where ?? {}));
            return o?.limit === undefined ? matched : matched.slice(0, o.limit);
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                historyRows.push({ ...data });
                return { id: `h_${historyRows.length}` };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { id: `r_${rows.size + 1}`, ...data } as Row;
            rows.set(row.id, row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const id = (o as any)?.where?.id;
            const row = rows.get(id);
            if (row) rows.set(id, { ...row, ...data });
            return { id: id ?? null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract.
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            return { deleted: rows.delete((o as any)?.where?.id) ? 1 : 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: (type: string, name: string) =>
                type === 'datasource' ? opts.registryDatasources?.[name] : undefined,
            getAllObjects: () => opts.registryObjects ?? [],
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            getArtifactItem: () => undefined,
            getAllPackages: () => [],
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => {},
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one item, as `state|schemaMode-or-external`. */
const stored = (rows: Map<string, Row>, type: string, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === type && r.name === name)
        .map((r) => {
            const body = JSON.parse(r.metadata);
            return `${r.state}|${type === 'datasource' ? body.schemaMode ?? '-' : body.external ? 'external' : '-'}`;
        });

/** A schema-valid datasource body. */
const datasource = (name: string, extra: Record<string, unknown> = {}) =>
    ({ name, label: 'Warehouse', driver: 'sqlite', config: { filename: `${name}.db` }, ...extra });
const FEDERATED = { schemaMode: 'external', external: { allowWrites: false } };

/** A schema-valid object body, bound `external` to `wh` unless `extra` says otherwise. */
const object = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: 'Order',
    sharingModel: 'private',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    datasource: 'wh',
    external: { remoteName: 'orders' },
    ...extra,
});

/** The finding's first sentence, spelled out. */
const managedFinding = (objectName: string, ds = 'wh') =>
    `Object '${objectName}' declares \`external\` on datasource '${ds}', whose \`schemaMode\` is 'managed' (the default when none is declared), so ObjectStack owns its schema and creates its tables.`;

const expectRefusal = (err: any, envelope: string, path: string, objectNames: string[]) => {
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(String(err.message).startsWith(`${envelope} failed spec validation: `), String(err?.message)).toBe(true);
    expect(err.issues).toHaveLength(objectNames.length);
    objectNames.forEach((objectName, i) => {
        expect(err.issues[i]).toMatchObject({ path, code: 'custom' });
        expect(String(err.issues[i].message).startsWith(managedFinding(objectName)), err.issues[i].message).toBe(true);
    });
};

const MANAGED_SHAPES: Array<[string, Record<string, unknown>]> = [
    ['no `schemaMode` (managed by default)', {}],
    ["`schemaMode: 'managed'`", { schemaMode: 'managed' }],
];

describe('[#25211] the object save door — `external` on a managed datasource this environment holds', () => {
    for (const [shape, dsExtra] of MANAGED_SHAPES) {
        it.each([
            ['publish', {}],
            ['draft', { mode: 'draft' }],
            ['publish under `force`', { force: true }],
        ])(`a stored datasource with ${shape}: %s is refused 422 at \`external\`, and no object row is stored`, async (_mode, saveOpts) => {
            const { protocol, rows } = makeSession();
            await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', dsExtra) });

            const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order'), ...saveOpts }));

            expectRefusal(err, 'object/wh_order', 'external', ['wh_order']);
            expect(stored(rows, 'object', 'wh_order')).toEqual([]);
        });
    }

    it('a datasource the code layer registers as managed refuses the binding the same way', async () => {
        const { protocol, rows } = makeSession({ registryDatasources: { wh: datasource('wh', { schemaMode: 'managed' }) } });

        const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') }));

        expectRefusal(err, 'object/wh_order', 'external', ['wh_order']);
        expect(rows.size).toBe(0);
    });

    it("the environment's stored row is the datasource judged, over the registered definition", async () => {
        // Registered federated, stored managed: the door reads the stored row
        // first, as its own by-name read serves the datasource.
        const { protocol, rows } = makeSession({ registryDatasources: { wh: datasource('wh', FEDERATED) } });
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', { schemaMode: 'managed' }) });

        const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') }));

        expectRefusal(err, 'object/wh_order', 'external', ['wh_order']);
        expect(stored(rows, 'object', 'wh_order')).toEqual([]);
    });
});

describe('[#25211] the datasource save door — managed while objects bind it with `external`', () => {
    for (const [shape, dsExtra] of MANAGED_SHAPES) {
        it.each([
            ['publish', {}],
            ['draft', { mode: 'draft' }],
        ])(`re-saving a federated datasource with ${shape} under a stored external object: %s is refused 422 at \`schemaMode\`, and the row is unchanged`, async (_mode, saveOpts) => {
            const { protocol, rows } = makeSession();
            await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
            await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') });

            const err = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', dsExtra), ...saveOpts }));

            expectRefusal(err, 'datasource/wh', 'schemaMode', ['wh_order']);
            expect(stored(rows, 'datasource', 'wh')).toEqual(['active|external']);
        });
    }

    it('one finding per bound object, a stored row and a registered object alike', async () => {
        const { protocol, rows } = makeSession({ registryObjects: [object('wh_shipment')] });
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
        await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') });

        const err = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh') }));

        expectRefusal(err, 'datasource/wh', 'schemaMode', ['wh_order', 'wh_shipment']);
        expect(stored(rows, 'datasource', 'wh')).toEqual(['active|external']);
    });

    it('a registered object is judged by the stored row that overlays it, when there is one', async () => {
        // The stored row is the object's base layer (ADR-0029 D9): it dropped
        // `external`, so the registered binding binds nothing here.
        const { protocol, rows } = makeSession({ registryObjects: [object('wh_order')] });
        await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order', { datasource: 'default', external: undefined }) });

        const result = await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh') });

        expect(result.success).toBe(true);
        expect(stored(rows, 'datasource', 'wh')).toEqual(['active|-']);
    });

    it("an object's draft binds nothing until its publish", async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
        await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order'), mode: 'draft' });

        const result = await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh') });

        expect(result.success).toBe(true);
        expect(stored(rows, 'datasource', 'wh')).toEqual(['active|-']);
    });
});

describe('[#25211] the publish of a draft is judged again, against the other half as it stands', () => {
    it('an object draft saved on a federated datasource is refused at publish once the datasource is managed', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
        await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order'), mode: 'draft' });
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', { schemaMode: 'managed' }) });

        const err = await refusalOf(protocol.publishMetaItem({ type: 'object', name: 'wh_order' }));

        expectRefusal(err, 'object/wh_order', 'external', ['wh_order']);
        expect(stored(rows, 'object', 'wh_order')).toEqual(['draft|external']);
    });

    it('a datasource draft saved as managed is refused at publish once an object binds it with `external`', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', { schemaMode: 'managed' }), mode: 'draft' });
        await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') });

        const err = await refusalOf(protocol.publishMetaItem({ type: 'datasource', name: 'wh' }));

        expectRefusal(err, 'datasource/wh', 'schemaMode', ['wh_order']);
        expect(stored(rows, 'datasource', 'wh').sort()).toEqual(['active|external', 'draft|managed']);
    });
});

describe('[#25211] controls — what the doors do not refuse', () => {
    it.each([
        ["`schemaMode: 'external'`", FEDERATED],
        ["`schemaMode: 'validate-only'`", { schemaMode: 'validate-only', external: { allowWrites: false } }],
    ])('a datasource with %s: the datasource and the bound object both save, and the datasource re-saves', async (_label, dsExtra) => {
        const { protocol, rows } = makeSession();
        expect((await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', dsExtra) })).success).toBe(true);
        expect((await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') })).success).toBe(true);
        expect((await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', { ...dsExtra, label: 'Renamed' }) })).success).toBe(true);
        expect(stored(rows, 'object', 'wh_order')).toEqual(['active|external']);
    });

    it('an object bound to a datasource no layer holds saves (absence is no evidence about `schemaMode`)', async () => {
        const { protocol, rows } = makeSession();
        const result = await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order', { datasource: 'lake' }) });
        expect(result.success).toBe(true);
        expect(stored(rows, 'object', 'wh_order')).toEqual(['active|external']);
    });

    it('an object without `external` saves on a managed datasource, and the datasource re-saves managed under it', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh') });
        expect((await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order', { external: undefined }) })).success).toBe(true);
        expect((await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', { schemaMode: 'managed' }) })).success).toBe(true);
        expect(stored(rows, 'datasource', 'wh')).toEqual(['active|managed']);
    });

    it('a datasource saves managed while external objects bind ANOTHER datasource', async () => {
        const { protocol } = makeSession({ registryObjects: [object('lake_order', { datasource: 'lake' })] });
        await protocol.saveMetaItem({ type: 'datasource', name: 'lake', item: datasource('lake', FEDERATED) });
        await protocol.saveMetaItem({ type: 'object', name: 'lake_item', item: object('lake_item', { datasource: 'lake' }) });

        expect((await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh') })).success).toBe(true);
    });
});

/**
 * [#25279] `os migrate meta --stored` lists the object rows the object save
 * door above refuses: a stored object bound `external` to a stored or
 * registered managed datasource. The row is planted as stored before that door
 * existed (straight into the table), then the pass is run in preview, and the
 * same body is offered to the door, so the listing and the refusal are read
 * off one environment.
 */
describe('[#25279] the stored-migration pass lists the object rows that door refuses', () => {
    const plantObjectRow = (rows: Map<string, Row>, body: Record<string, unknown>) => {
        const id = `r_${rows.size + 1}`;
        rows.set(id, {
            id, type: 'object', name: String(body.name), state: 'active', package_id: null,
            metadata: JSON.stringify(body),
        });
    };
    const LISTED_ID = 'object-external-binding-managed-datasource-refused';
    const listedRows = (report: any) =>
        report.rows
            .filter((r: any) => r.todos.some((t: any) => t.conversionId === LISTED_ID))
            .map((r: any) => `${r.type}/${r.name}|${r.outcome}`);

    for (const [shape, dsExtra] of MANAGED_SHAPES) {
        it(`a stored object on a stored datasource with ${shape} is listed, and its next save is refused`, async () => {
            const { protocol, rows } = makeSession();
            await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', dsExtra) });
            plantObjectRow(rows, object('wh_order'));

            const report = await protocol.migrateStoredMetadata({});

            expect(listedRows(report)).toEqual(['object/wh_order|skipped']);
            const todo = report.rows.find((r: any) => r.name === 'wh_order').todos.find((t: any) => t.conversionId === LISTED_ID);
            expect(todo.path).toBe('objects[0].external');
            expect(todo.reason).toContain(managedFinding('wh_order'));
            const err = await refusalOf(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') }));
            expectRefusal(err, 'object/wh_order', 'external', ['wh_order']);
        });
    }

    it('a stored object on a datasource the code layer registers as managed is listed the same way', async () => {
        const { protocol, rows } = makeSession({ registryDatasources: { wh: datasource('wh', { schemaMode: 'managed' }) } });
        plantObjectRow(rows, object('wh_order'));

        expect(listedRows(await protocol.migrateStoredMetadata({}))).toEqual(['object/wh_order|skipped']);
    });

    it("the environment's stored datasource row is the one judged, over the registered definition", async () => {
        const { protocol, rows } = makeSession({ registryDatasources: { wh: datasource('wh', { schemaMode: 'managed' }) } });
        await protocol.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) });
        plantObjectRow(rows, object('wh_order'));

        const report = await protocol.migrateStoredMetadata({});

        expect(listedRows(report)).toEqual([]);
        expect(report.canonical).toBeGreaterThanOrEqual(1);
        await expect(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: object('wh_order') })).resolves.toBeDefined();
    });

    it.each([
        ['a federated stored datasource', (p: any) => p.saveMetaItem({ type: 'datasource', name: 'wh', item: datasource('wh', FEDERATED) })],
        ['a datasource no layer holds', async () => {}],
    ])('a stored object on %s is not listed', async (_label, seed) => {
        const { protocol, rows } = makeSession();
        await seed(protocol);
        plantObjectRow(rows, object('wh_order'));

        const report = await protocol.migrateStoredMetadata({});

        expect(listedRows(report)).toEqual([]);
        expect(report.rows.filter((r: any) => r.name === 'wh_order')).toEqual([]);
    });
});
