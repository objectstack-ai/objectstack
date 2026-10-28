// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26462 — `diffMetaItem` answered a version the item has no history row at
 * as an EMPTY side, with a 200: `?from=998&to=999` read as "no change",
 * `?from=1&to=999` as "everything removed", and an item that never existed as
 * "no change". ADR-0110 D3 rules that kind of answer out — a miss must never
 * read as a fact about the document — and the rollback door on the same item
 * already refuses the same number 404 `VERSION_NOT_FOUND`.
 *
 * The refusal is the rollback door's own ({@link versionNotFoundError}), so
 * both doors name a missing version in one sentence; the parity arm below
 * pins that by comparing the two answers, not by pinning the prose.
 *
 * What stays served, and is pinned here as the controls:
 *  - a named version that HAS a row, including a delete tombstone (a body-less
 *    row is a real version: the item did not exist there);
 *  - the default range (no `from` / `to`, #20397 / #20451), for any item.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './index.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';

const TYPE = 'dashboard';
const NAME = 'qa_diff_probe';

/**
 * Scalar equality only, and it REFUSES a combinator rather than guessing —
 * `check:where-matcher` shape (b): treating `$or` as a column name silently
 * excludes rows and greens the suite against a query nobody wrote.
 */
function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k.startsWith('$')) {
            throw new Error(
                `stub engine: WHERE combinator '${k}' is not implemented by this double — `
                + 'it matches scalar equality only. Implement it here rather than letting it '
                + 'be read as a field name.',
            );
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_metadata: [],
        sys_metadata_history: [],
    };
    const engine: any = {
        async find(table: string, o: { where: Record<string, unknown>; limit?: number }) {
            const rows = (tables[table] ?? []).filter((r) => matches(r, o.where));
            return typeof o?.limit === 'number' ? rows.slice(0, o.limit) : rows;
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            return (tables[table] ?? []).find((r) => matches(r, o.where)) ?? null;
        },
        async insert() { return { id: 'stub' }; },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, tables };
}

/**
 * The card's reproduction, steps 1–2: v1 and v2 of one item, differing only in
 * `label`, and v2 live. `bodies` overrides the default pair; a `null` body is
 * a delete tombstone.
 */
function seedHistory(
    tables: Record<string, Array<Record<string, unknown>>>,
    name: string,
    bodies: Array<Record<string, unknown> | null> = [
        { name, label: 'QA Diff', widgets: [] },
        { name, label: 'QA Diff v2', widgets: [] },
    ],
) {
    const base = { organization_id: null, type: TYPE, name };
    bodies.forEach((body, i) => {
        tables.sys_metadata_history!.push({
            ...base,
            id: `h_${name}_${i + 1}`,
            version: i + 1,
            event_seq: i + 1,
            operation_type: body === null ? 'delete' : i === 0 ? 'create' : 'update',
            metadata: body === null ? null : JSON.stringify(body),
            checksum: body === null ? null : hashSpec(body),
            recorded_at: new Date(i + 1).toISOString(),
        });
    });
    const live = bodies[bodies.length - 1];
    if (live) {
        tables.sys_metadata!.push({
            ...base,
            id: `m_${name}`,
            state: 'active',
            version: bodies.length,
            metadata: JSON.stringify(live),
        });
    }
}

/** The refusal, or `null` when the call answered. */
async function refusalOf(p: Promise<unknown>): Promise<any> {
    return p.then(() => null, (e: unknown) => e);
}

function expectVersionNotFound(err: any, version: number) {
    // ADR-0112 envelope — code AND status; `.toThrow()` alone stays green on
    // a bare `Error`.
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('VERSION_NOT_FOUND');
    expect(err.status).toBe(404);
    // Names the missing version, as the card's expected answer asks.
    expect(err.message).toContain(`version ${version} `);
}

describe('#26462 — an explicitly named version with no history row is refused 404 VERSION_NOT_FOUND', () => {
    it('step 3, the control: two versions that exist answer their diff', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 1, toVersion: 2 });

        expect(res.fromVersion).toBe(1);
        expect(res.toVersion).toBe(2);
        expect(res.changed).toEqual([{ path: 'label', from: 'QA Diff', to: 'QA Diff v2' }]);
        expect(res.added).toEqual([]);
        expect(res.removed).toEqual([]);
    });

    it('step 4: both versions missing — refused, not "no change"', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 998, toVersion: 999 }));

        expect(err).not.toBeNull();
        expect(err.code).toBe('VERSION_NOT_FOUND');
        expect(err.status).toBe(404);
    });

    it('step 5: the to side missing — refused, not "everything removed"', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 1, toVersion: 999 }));

        expectVersionNotFound(err, 999);
    });

    it('the from side missing — refused, not "everything added"', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 999, toVersion: 2 }));

        expectVersionNotFound(err, 999);
    });

    it('one side named and missing, the other defaulted — refused on either side', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        expectVersionNotFound(await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, toVersion: 999 })), 999);
        expectVersionNotFound(await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 999 })), 999);
    });

    it('step 6: an item that never existed — refused, not "no change"', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: 'qa_no_such_xyz', fromVersion: 1, toVersion: 2 }));

        expect(err).not.toBeNull();
        expect(err.code).toBe('VERSION_NOT_FOUND');
        expect(err.status).toBe(404);
        expect(err.message).toContain(`${TYPE}/qa_no_such_xyz`);
    });

    it('a version number from ANOTHER item\'s history is this item\'s miss — refused, never that item\'s body', async () => {
        // The card's open question. `other` has a v3; `NAME` stops at v2. The
        // history read is keyed by (type, name), so `other`'s v3 is never a
        // candidate: before the fix this answered `NAME`'s v1 against an
        // EMPTY side (everything removed), not against `other`'s body.
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        seedHistory(tables, 'other', [
            { name: 'other', label: 'O1', secret_marker: 'x' },
            { name: 'other', label: 'O2', secret_marker: 'x' },
            { name: 'other', label: 'O3', secret_marker: 'x' },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 1, toVersion: 3 }));

        expectVersionNotFound(err, 3);
        expect(err.message).toContain(`${TYPE}/${NAME}`);
        expect(err.message).not.toContain('other');
    });

    it('the refusal is the rollback door\'s, sentence for sentence', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const repo = new SysMetadataRepository({ engine });

        const diffErr = await refusalOf(protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 1, toVersion: 999 }));
        const rollbackErr = await refusalOf(repo.restoreVersion({ org: 'system', type: TYPE, name: NAME }, 999, { actor: null }));

        expect(rollbackErr).not.toBeNull();
        expect(diffErr).not.toBeNull();
        expect({ code: diffErr.code, status: diffErr.status, message: diffErr.message })
            .toEqual({ code: rollbackErr.code, status: rollbackErr.status, message: rollbackErr.message });
    });
});

describe('#26462 — what stays served', () => {
    it('a delete tombstone is a real version: diffed as an empty side, not refused', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME, [
            { name: NAME, label: 'QA Diff', widgets: [] },
            null,
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: TYPE, name: NAME, fromVersion: 1, toVersion: 2 });

        expect(res.toVersion).toBe(2);
        expect(res.removed.map((e: any) => e.path).sort()).toEqual(['label', 'name', 'widgets']);
    });

    it('the default range of an item with history is unchanged', async () => {
        const { engine, tables } = makeStubEngine();
        seedHistory(tables, NAME);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: TYPE, name: NAME });

        expect(res.fromVersion).toBe(1);
        expect(res.toVersion).toBe(2);
        expect(res.changed).toEqual([{ path: 'label', from: 'QA Diff', to: 'QA Diff v2' }]);
    });

    it('the default range of an item with no history is unchanged: both sides absent, nothing refused', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({ type: TYPE, name: 'qa_no_such_xyz' });

        expect(res).toMatchObject({ fromVersion: null, toVersion: null, added: [], removed: [], changed: [] });
    });
});
