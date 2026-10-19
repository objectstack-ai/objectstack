// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL refuses (`check:engine-double-contract`).
// Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [#24547 · ADR-0129 D2] The package namespace-prefix rule holds at BOTH
 * runtime doors that make an object live.
 *
 * ADR-0129 D2: a package declares its prefix once (`manifest.namespace`), and
 * every object it defines MUST be named `${namespace}_${shortName}`. The
 * draft-publish door (`publishPackageDrafts`) refused an unprefixed object
 * draft with `NAMESPACE_PREFIX`, while the direct (publish-mode) save door
 * stored the very same name `active` under the very same package — an object
 * live under a name its own package's drafts could never publish again, and
 * two runtime doors giving opposite verdicts on one name.
 *
 * Measured through the wire before the fix (stock showcase):
 * `PUT /api/v1/meta/object/v1_report?package=com.v1.rollup` answered 200
 * `state: "active"`, and the same name's draft was refused at
 * `POST /api/v1/packages/com.v1.rollup/publish-drafts` with
 * `NAMESPACE_PREFIX`.
 *
 * What these cases pin:
 *  - the active door refuses the unprefixed name, with the envelope the door
 *    gives every other authoring refusal (`code` + `status`), the authored
 *    prescription the publish door serves for the same name, and nothing
 *    written;
 *  - the prefixed name saves;
 *  - a package that declares no namespace, and a save naming no package, are
 *    untouched (the rule is skipped without a namespace, as `defineStack`
 *    skips it);
 *  - a package-less publish save the door resolves INTO a namespaced package
 *    is judged as a save naming that package;
 *  - a draft save is unchanged, and the publish door still refuses its draft —
 *    with the same sentence the active door now answers.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        // `undefined` = "dimension not constrained"; `null` = "must be NULL".
        if (v === undefined) continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const op = v as Record<string, unknown>;
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes((r as any)[k])) return false;
                continue;
            }
            if ('$ne' in op) {
                if ((r as any)[k] === op.$ne) return false;
                continue;
            }
        }
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

const PKG = 'com.v1.rollup';
const NS = 'rollup';
/** A package that declares no namespace — legacy-grandfathered. */
const BARE_PKG = 'com.v1.bare';

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const manifests: Record<string, Record<string, unknown>> = {
        [PKG]: { id: PKG, namespace: NS },
        [BARE_PKG]: { id: BARE_PKG },
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where ?? {}));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table !== 'sys_metadata') return { id: `x_${nextId}` };
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(opts.where);
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
            getPackage: (id: string) => (manifests[id] ? { manifest: manifests[id] } : undefined),
        },
    };
    return { engine, rows };
}

const objectBody = (name: string, label = `Object ${name}`) => ({
    name,
    label,
    // [#8308] Authored OWD — the authoring gate refuses an OWD-less custom object.
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
    },
});

/** The stored rows for one object name, as `(state, package_id)` pairs. */
const rowsFor = (rows: Map<string, Row>, name: string) =>
    Array.from(rows.values())
        .filter((r) => r.type === 'object' && r.name === name)
        .map((r) => ({ state: r.state, package_id: r.package_id }));

describe('[#24547 · ADR-0129 D2] the active save door refuses an object without its package namespace prefix', () => {
    it('refuses an unprefixed object under a namespaced package — NAMESPACE_PREFIX / 422, nothing written', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const outcome = await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report'),
            packageId: PKG,
        }).then(() => 'saved', (e: unknown) => e);

        expect(outcome).toMatchObject({ code: 'NAMESPACE_PREFIX', status: 422 });
        // The prescription names the rename and the namespace it comes from.
        expect((outcome as Error).message).toMatch(/^Object 'v1_report' is missing the package namespace prefix\. /);
        expect((outcome as Error).message).toContain(`Rename it to '${NS}_v1_report'`);
        // Refused before any write: no row, active or draft, under any package.
        expect(rowsFor(rows, 'v1_report')).toEqual([]);
    });

    it('saves the prefixed name under the same package', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: `${NS}_v1_report`,
            item: objectBody(`${NS}_v1_report`),
            packageId: PKG,
        });

        expect(rowsFor(rows, `${NS}_v1_report`)).toEqual([{ state: 'active', package_id: PKG }]);
    });

    it('control: a package that declares no namespace saves the unprefixed name', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report'),
            packageId: BARE_PKG,
        });

        expect(rowsFor(rows, 'v1_report')).toEqual([{ state: 'active', package_id: BARE_PKG }]);
    });

    it('control: a save naming no package (and resolving to none) saves the unprefixed name', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report'),
        });

        expect(rowsFor(rows, 'v1_report')).toEqual([{ state: 'active', package_id: null }]);
    });

    it('judges a package-less publish save against the namespaced package it resolves into', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // An active row bound to the namespaced package already holds the
        // name (stored before this door read the rule), so a save naming no
        // package writes THAT package's row.
        await engine.insert('sys_metadata', {
            type: 'object',
            name: 'v1_report',
            organization_id: null,
            package_id: PKG,
            state: 'active',
            metadata: JSON.stringify(objectBody('v1_report')),
            checksum: 'sha256:stored',
            version: 1,
        });

        const outcome = await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report', 'Edited'),
        }).then(() => 'saved', (e: unknown) => e);

        expect(outcome).toMatchObject({ code: 'NAMESPACE_PREFIX', status: 422 });
        // The stored row is untouched.
        const stored = Array.from(rows.values()).find((r) => r.name === 'v1_report');
        expect(JSON.parse(stored!.metadata).label).toBe('Object v1_report');
    });

    it('a draft save is unchanged, and the publish door refuses that draft with the sentence the active door answers', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const activeRefusal = await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report'),
            packageId: PKG,
        }).then(() => undefined, (e: Error) => e);

        // The draft save stores, as before — the publish pre-flight is the
        // gate a draft answers to.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'v1_report',
            item: objectBody('v1_report'),
            packageId: PKG,
            mode: 'draft',
        });
        expect(rowsFor(rows, 'v1_report')).toEqual([{ state: 'draft', package_id: PKG }]);

        const res = await protocol.publishPackageDrafts({ packageId: PKG } as any);

        expect(res).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 1 });
        expect(res.failed[0]).toMatchObject({ type: 'object', name: 'v1_report', code: 'NAMESPACE_PREFIX' });
        // ONE rule, ONE sentence: the two doors cannot disagree on the verdict
        // or on what the author is told to do about it.
        expect(activeRefusal).toBeInstanceOf(Error);
        expect(res.failed[0].error).toBe(activeRefusal!.message);
        // Nothing went live.
        expect(rowsFor(rows, 'v1_report')).toEqual([{ state: 'draft', package_id: PKG }]);
    });
});
