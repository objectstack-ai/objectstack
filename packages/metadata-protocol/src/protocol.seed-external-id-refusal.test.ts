// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28952] The metadata save doors refuse a keyed `seed` whose `externalId`
 * names no field of the seed's object.
 *
 * Measured on `origin/main` before this file: a seed saved with
 * `mode: 'upsert'` and `externalId: 'no_such_field'` was stored in draft and
 * in publish mode and promoted by `publishPackageDrafts`. The loader keys each
 * existing row and each incoming record by that field, which no row carries,
 * so every key was empty, nothing matched, and every publish inserted each
 * record again with a success receipt.
 *
 * Pinned here, through `saveMetaItem`, `publishMetaItem`,
 * `publishPackageDrafts` and the restore door:
 *  - the refusal: the save door's envelope for a body it judges (the one
 *    the unknown-datasource refusal answers), `422 INVALID_METADATA`, one
 *    finding per missing member at `externalId` (`externalId.N` for a
 *    composite member), naming the field and the object, nothing stored
 *    (save), nothing promoted and no seed row written (publish of a draft
 *    stored before the rule; the batch aborts);
 *  - an undeclared `externalId` is `SeedSchema`'s default, `name`, and is
 *    judged as such;
 *  - an object drafted in the same package batch is judged as it will be
 *    published;
 *  - controls: a declared field, an injected column (`id`), every member of
 *    a composite declared, `insert` and `replace` (they never match), a
 *    draft seed whose object is itself still a draft, an object neither
 *    registered nor drafted, and a `migrate-stored` re-save.
 *
 * Each refusal is asserted by its code, its status, its path and its
 * finding's first clause, spelled out here.
 *
 * Harness: the stateful `sys_metadata` double of
 * `protocol.unknown-datasource-refusal.test.ts`, kept local, with a registry
 * that answers registered objects and a log of every data-table insert.
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

const PKG = 'app.seedkey';

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

function makeSession(opts: { objects?: Record<string, Record<string, unknown>> } = {}) {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    /** Every insert into an app table (not a `sys_*` platform table): a seed row written. */
    const dataInserts: string[] = [];
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
            if (table !== 'sys_metadata') {
                if (!table.startsWith('sys_')) dataInserts.push(table);
                return Array.isArray(data) ? data.map((d, i) => ({ ...d, id: `d_${nextId}_${i}` })) : { ...data, id: `d_${nextId}` };
            }
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
            getItem: () => undefined,
            getObject: (name: string) => opts.objects?.[name],
            getAllObjects: () => Object.values(opts.objects ?? {}),
            // An installed authored base that declares no namespace.
            getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, dataInserts };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one item, as `state|package|externalId`. */
const stored = (rows: Map<string, Row>, type: string, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === type && r.name === name)
        .map((r) => `${r.state}|${r.package_id ?? '-'}|${JSON.stringify(JSON.parse(r.metadata).externalId ?? null)}`)
        .sort();

/** A schema-valid object body with `name` and `sku` text fields (or the given ones). */
const object = (name: string, fields: string[] = ['name', 'sku']) => ({
    name,
    label: 'Seed Key',
    sharingModel: 'private',
    fields: Object.fromEntries(fields.map((f) => [f, { type: 'text', label: f }])),
});

/** The registered (served) form: the authored fields plus the columns the registry injects. */
const registered = (name: string, fields: string[] = ['name', 'sku']) => ({
    ...object(name, fields),
    fields: {
        ...object(name, fields).fields,
        id: { type: 'text' }, created_at: { type: 'datetime' }, updated_at: { type: 'datetime' },
    },
});

/** A seed body; `externalId` omitted when `undefined`. */
const seed = (target: string, externalId: string | string[] | undefined, mode = 'upsert') => ({
    object: target,
    mode,
    ...(externalId !== undefined ? { externalId } : {}),
    records: [{ name: 'G1', sku: 'g', organization_id: 'org_seedkey' }],
});

/** Plant a seed draft as a draft stored before the rule sits at rest. */
function plantSeedDraft(rows: Map<string, Row>, name: string, body: Record<string, unknown>, packageId: string | null = PKG) {
    const data = {
        type: 'seed', name, organization_id: null, package_id: packageId,
        state: 'draft', metadata: JSON.stringify(body),
    };
    rows.set(keyOf(data), { ...data, id: `planted_${name}` });
}

/** A declared member's finding, up to its consequence. */
const memberFinding = (seedName: string, member: string, objectName: string) =>
    `Seed '${seedName}' keys on externalId member '${member}', which is not a field of object '${objectName}', `;

const expectRefusal = (err: any, seedName: string, findings: Array<{ path: string; member: string; object: string; implicit?: boolean }>) => {
    expect({ code: err?.code, status: err?.status }, String(err?.message)).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect(String(err.message).startsWith(`seed/${seedName} failed spec validation: `), String(err.message)).toBe(true);
    expect(err.issues.map((i: any) => ({ path: i.path, code: i.code }))).toEqual(findings.map((f) => ({ path: f.path, code: 'custom' })));
    findings.forEach((f, n) => {
        const first = f.implicit
            ? `Seed '${seedName}' declares no externalId, so it keys on the default 'name', which is not a field of object '${f.object}', `
            : memberFinding(seedName, f.member, f.object);
        expect(String(err.issues[n].message).startsWith(first), err.issues[n].message).toBe(true);
        expect(String(err.issues[n].message).length).toBeLessThanOrEqual(500);
    });
};

const OBJECTS = { seedkey_other: registered('seedkey_other') };

describe('[#28952] the seed save door — an `externalId` that names no field of the object', () => {
    it.each([
        ['a draft save into a package', { mode: 'draft', packageId: PKG }],
        ['a draft save naming no package', { mode: 'draft' }],
        ['a publish save', {}],
    ])('%s is refused 422 at `externalId`, naming the field, and nothing is stored or loaded', async (_label, saveOpts) => {
        const { protocol, rows, dataInserts } = makeSession({ objects: OBJECTS });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'seed', name: 'r_ghost', item: seed('seedkey_other', 'no_such_field'), ...saveOpts,
        }));

        expectRefusal(err, 'r_ghost', [{ path: 'externalId', member: 'no_such_field', object: 'seedkey_other' }]);
        expect(stored(rows, 'seed', 'r_ghost')).toEqual([]);
        expect(dataInserts).toEqual([]);
    });

    it.each([['upsert'], ['ignore'], ['update']])('mode `%s` is refused the same way', async (mode) => {
        const { protocol } = makeSession({ objects: OBJECTS });
        const err = await refusalOf(protocol.saveMetaItem({
            type: 'seed', name: 'r_ghost', item: seed('seedkey_other', 'no_such_field', mode), mode: 'draft',
        }));
        expectRefusal(err, 'r_ghost', [{ path: 'externalId', member: 'no_such_field', object: 'seedkey_other' }]);
    });

    it('a composite `externalId` with one member the object lacks is refused at that member', async () => {
        const { protocol, rows } = makeSession({ objects: OBJECTS });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'seed', name: 'r_pair', item: seed('seedkey_other', ['sku', 'no_such_field']), mode: 'draft',
        }));

        expectRefusal(err, 'r_pair', [{ path: 'externalId.1', member: 'no_such_field', object: 'seedkey_other' }]);
        expect(stored(rows, 'seed', 'r_pair')).toEqual([]);
    });

    it("an undeclared `externalId` is the default 'name', refused on an object with no `name` field", async () => {
        const { protocol } = makeSession({ objects: { seedkey_sku: registered('seedkey_sku', ['sku']) } });

        const err = await refusalOf(protocol.saveMetaItem({
            type: 'seed', name: 'r_default', item: { object: 'seedkey_sku', records: [{ sku: 'g' }] }, mode: 'draft',
        }));

        expectRefusal(err, 'r_default', [{ path: 'externalId', member: 'name', object: 'seedkey_sku', implicit: true }]);
    });
});

describe('[#28952] the publish doors — a seed draft stored before the rule', () => {
    it('publishMetaItem refuses it, the draft stays a draft, and no seed row is written', async () => {
        const { protocol, rows, dataInserts } = makeSession({ objects: OBJECTS });
        plantSeedDraft(rows, 'r_ghost', seed('seedkey_other', 'no_such_field'), null);

        const err = await refusalOf(protocol.publishMetaItem({ type: 'seed', name: 'r_ghost' }));

        expectRefusal(err, 'r_ghost', [{ path: 'externalId', member: 'no_such_field', object: 'seedkey_other' }]);
        expect(stored(rows, 'seed', 'r_ghost')).toEqual(['draft|-|"no_such_field"']);
        expect(dataInserts).toEqual([]);
    });

    it('publishPackageDrafts answers `refused`, names it, and promotes and loads nothing of the batch', async () => {
        const { protocol, rows, dataInserts } = makeSession({ objects: OBJECTS });
        plantSeedDraft(rows, 'r_ghost', seed('seedkey_other', 'no_such_field'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ outcome: 'refused', success: false, publishedCount: 0, published: [] });
        const causal = res.failed.find((f: any) => f.name === 'r_ghost');
        expect(causal, JSON.stringify(res.failed)).toMatchObject({ type: 'seed', code: 'INVALID_METADATA' });
        expect(JSON.stringify(causal)).toContain("externalId member 'no_such_field', which is not a field of object 'seedkey_other'");
        expect(stored(rows, 'seed', 'r_ghost')).toEqual([`draft|${PKG}|"no_such_field"`]);
        expect(dataInserts).toEqual([]);
    });

    it('an object drafted in the same batch is judged as it will be published: lacking the field, the batch is refused', async () => {
        const { protocol, rows, dataInserts } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'seedkey_new', item: object('seedkey_new'), mode: 'draft', packageId: PKG });
        // The object is still a draft, so the seed's draft save cannot judge it…
        const saved = await protocol.saveMetaItem({
            type: 'seed', name: 'r_new', item: seed('seedkey_new', 'no_such_field'), mode: 'draft', packageId: PKG,
        });
        expect(saved.success).toBe(true);

        // …and its publish, beside that object draft, does.
        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ outcome: 'refused', success: false, publishedCount: 0 });
        const causal = res.failed.find((f: any) => f.name === 'r_new');
        expect(causal, JSON.stringify(res.failed)).toMatchObject({ type: 'seed', code: 'INVALID_METADATA' });
        expect(JSON.stringify(causal)).toContain("externalId member 'no_such_field', which is not a field of object 'seedkey_new'");
        expect(stored(rows, 'seed', 'r_new')).toEqual([`draft|${PKG}|"no_such_field"`]);
        expect(dataInserts).toEqual([]);
    });
});

describe('[#28952] the restore door — a seed version whose `externalId` names no field', () => {
    it('is refused with the save door\'s envelope', async () => {
        const { protocol } = makeSession({ objects: OBJECTS });
        const err = await refusalOf(protocol.refuseRestoredBodyTheSaveDoorRefuses(
            'seed', 'r_ghost', seed('seedkey_other', 'no_such_field'), null, 'protocol.restoreMetaItem',
        ));
        expectRefusal(err, 'r_ghost', [{ path: 'externalId', member: 'no_such_field', object: 'seedkey_other' }]);
    });
});

describe('[#28952] controls — an `externalId` the object has is not refused', () => {
    it.each([
        ["`externalId: 'name'`", 'name'],
        ["`externalId: 'sku'`", 'sku'],
        ['an injected column, `id`', 'id'],
        ['a composite whose every member is a field', ['name', 'sku']],
        ["undeclared (the default 'name')", undefined],
    ])('%s: saves as a draft, publishes, and saves live', async (_label, externalId) => {
        const { protocol, rows, dataInserts } = makeSession({ objects: OBJECTS });
        await protocol.saveMetaItem({ type: 'seed', name: 'r_ok', item: seed('seedkey_other', externalId), mode: 'draft', packageId: PKG });
        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res, JSON.stringify(res.failed)).toMatchObject({ outcome: 'published', publishedCount: 1 });
        // The publish loaded the seed: the double records the row it wrote.
        expect(dataInserts).toEqual(['seedkey_other']);
        expect((await protocol.saveMetaItem({ type: 'seed', name: 'r_ok2', item: seed('seedkey_other', externalId) })).success).toBe(true);
        expect(stored(rows, 'seed', 'r_ok')).toEqual([`active|${PKG}|${JSON.stringify(externalId ?? null)}`]);
    });

    it.each([['insert'], ['replace']])('mode `%s` never matches by `externalId`, so it is not judged', async (mode) => {
        const { protocol, rows } = makeSession({ objects: OBJECTS });
        const res = await protocol.saveMetaItem({ type: 'seed', name: 'r_ins', item: seed('seedkey_other', 'no_such_field', mode), mode: 'draft' });
        expect(res.success).toBe(true);
        expect(stored(rows, 'seed', 'r_ins')).toEqual(['draft|-|"no_such_field"']);
    });

    it('an object drafted in the same batch that declares the field publishes with the seed', async () => {
        const { protocol, rows } = makeSession();
        await protocol.saveMetaItem({ type: 'object', name: 'seedkey_new', item: object('seedkey_new'), mode: 'draft', packageId: PKG });
        await protocol.saveMetaItem({ type: 'seed', name: 'r_new', item: seed('seedkey_new', 'sku'), mode: 'draft', packageId: PKG });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res, JSON.stringify(res.failed)).toMatchObject({ outcome: 'published', publishedCount: 2 });
        expect(stored(rows, 'seed', 'r_new')).toEqual([`active|${PKG}|"sku"`]);
    });

    it('an object neither registered nor drafted is not judged here (the load reports it)', async () => {
        const { protocol, rows } = makeSession();
        const res = await protocol.saveMetaItem({ type: 'seed', name: 'r_far', item: seed('seedkey_elsewhere', 'no_such_field'), mode: 'draft' });
        expect(res.success).toBe(true);
        expect(stored(rows, 'seed', 'r_far')).toEqual(['draft|-|"no_such_field"']);
    });

    it('a `migrate-stored` re-save of a stored seed is not judged', async () => {
        const { protocol, rows } = makeSession({ objects: OBJECTS });
        const res = await protocol.saveMetaItem({
            type: 'seed', name: 'r_old', item: seed('seedkey_other', 'no_such_field', 'insert'), mode: 'draft',
        });
        expect(res.success).toBe(true);
        const migrated = await protocol.saveMetaItem({
            type: 'seed', name: 'r_old', item: seed('seedkey_other', 'no_such_field'), mode: 'draft', source: 'migrate-stored',
        });
        expect(migrated.success).toBe(true);
        expect(stored(rows, 'seed', 'r_old')).toEqual(['draft|-|"no_such_field"']);
    });
});
