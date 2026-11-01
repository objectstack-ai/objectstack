// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, #28564] The `__c` extension-field reservation at every door
 * of this package — one judge (`protocol-extension-field-suffix.ts`), asked by
 * the save door, the restore doors, the draft promotion (`publishMetaItem` and
 * the `publishPackageDrafts` batch that shares it) and `duplicatePackage`; and
 * `installPackage`, which its closed manifest already covers.
 *
 * Maintainer, verbatim: 「扩展字段用 __c 后缀，只有 .custom 包能用。」
 *
 *  - (a) in a package that is not a base's paired `.custom`, a field spelled
 *    `__c` is refused, on its own objects or in its `objectExtensions`;
 *  - (b) in a `.custom` pair, an `objectExtensions[].fields` key without the
 *    suffix is refused.
 *
 * An `object` body is the only shape that reaches the save, restore and
 * promotion doors and `duplicatePackage`, and a `.custom` pair's own object is
 * not judged, so those doors pin case (a) and the pair's admit; case (b) needs
 * an `objectExtensions` entry, pinned on the judge itself here and at the two
 * doors outside this package that receive one (`os validate` in
 * `@objectstack/cli`, the marketplace install in `@objectstack/cloud-connection`).
 *
 * Every refusal asserts the active doors' envelope (`VALIDATION_ERROR` / 400,
 * `issues[]` locating the field) and that nothing was written, and is paired
 * with a CONTROL through the same door. The stub engine and its staging of a
 * stored body are copied from `protocol.item-name-every-door.test.ts`, not
 * imported, so each pin fails on its own; a body the doors now refuse is staged
 * as a row stored before the rule (`residueField()`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { judgeExtensionFieldSuffix } from './protocol-extension-field-suffix.js';

const BOUND = 'app.probe-bound';
/** {@link BOUND}'s paired customization package. */
const PAIR = 'app.probe-bound.custom';

/**
 * [#26708] The packages this file's saves name, installed: a save naming a
 * package no installed package has is refused (`WRITABLE_PACKAGE_REQUIRED`)
 * before any gate this file pins is reached. Each answers a manifest that
 * declares no dependencies, as an authored base does.
 */
const INSTALLED_PACKAGES: ReadonlySet<string> = new Set([BOUND, PAIR, 'app.dupsrc.custom']);
const installedPackage = (id: string) => (INSTALLED_PACKAGES.has(id) ? { manifest: { id } } : undefined);


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

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

/**
 * A double that STORES rows and history and whose registry keys an item by
 * its own `name`, the way `SchemaRegistry.registerItem` does — a no-op
 * registry would pass every "nothing registered" assertion vacuously.
 * Copied from `protocol.recovery-doors-emit-mutation.test.ts`, not imported,
 * so each pin can fail on its own.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const registered = new Map<string, Map<string, unknown>>();
    let nextId = 0;
    let commit: unknown = null;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // Hold the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract.
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        // A transaction that ROLLS BACK, the property `publishPackageDrafts`'
        // Phase 1 stands on (ADR-0067 D2): a throw restores the rows and the
        // history it started with. The registry is not part of it — Phase 1
        // defers every registry mutation to Phase 2 — so it is not snapshotted.
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            const rowsAtBegin = new Map(rows);
            const historyAtBegin = historyRows.slice();
            try {
                return await cb(undefined, { owned: true });
            } catch (error) {
                rows.clear();
                for (const [k, r] of rowsAtBegin) rows.set(k, r);
                historyRows.splice(0, historyRows.length, ...historyAtBegin);
                throw error;
            }
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            getObject: () => undefined,
            getPackage: installedPackage,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    return {
        engine,
        rows,
        historyRows,
        registered,
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    // `environmentId` UNDEFINED on purpose — see the header.
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    expect(protocol.environmentId).toBeUndefined();
    // `OS_METADATA_WRITABLE` is memoised process-wide; clear it rather than assume.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    const saveDoor = vi.spyOn(protocol, 'saveMetaItem');
    return { protocol, saveDoor, ...h };
}

type Harness = ReturnType<typeof makeProtocol>;

/** An object body with one plain field and the fields named in `extra`. */
const obj = (name: string, label: string, ...extra: string[]) => ({
    name,
    label,
    sharingModel: 'private',
    fields: Object.fromEntries([
        ['title', { type: 'text', label: 'Title' }],
        ...extra.map((f) => [f, { type: 'text', label: f }]),
    ]),
});

/** Every stored object row as `{ row, state, binding, fields }`. */
const storedObjects = (h: Harness) => Array.from(h.rows.values())
    .filter((r) => r.type === 'object')
    .map((r) => ({ row: r.name, state: r.state, binding: r.package_id ?? null, fields: Object.keys(JSON.parse(r.metadata).fields ?? {}) }));

/**
 * Add a field to a stored body in place — a row as it sits at rest when it was
 * written before this rule. `version` addresses a history row.
 */
function residueField(h: Harness, where: { name: string; state?: string; version?: number }, field: string) {
    const add = (metadata: string) => {
        const body = JSON.parse(metadata);
        return JSON.stringify({ ...body, fields: { ...body.fields, [field]: { type: 'text', label: field } } });
    };
    if (where.version !== undefined) {
        const row = h.historyRows.find((r) => r.type === 'object' && r.name === where.name && r.version === where.version);
        if (!row?.metadata) throw new Error(`no history row object/${where.name}@${where.version}`);
        row.metadata = add(row.metadata);
        return;
    }
    const row = Array.from(h.rows.values())
        .find((r) => r.type === 'object' && r.name === where.name && r.state === (where.state ?? 'active'));
    if (!row) throw new Error(`no ${where.state ?? 'active'} object row ${where.name}`);
    row.metadata = add(row.metadata);
}

/** The minimum a rejection pin asserts: the ADR-0112 envelope, not "it threw". */
function expectEnvelope(error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
}

/** Case (a)'s refusal of `field` on `object` in `packageId`, located at `path`. */
function expectReservedRefusal(error: any, field: string, object: string, packageId: string, path = `fields.${field}`) {
    expectEnvelope(error);
    expect(error.issues).toEqual([expect.objectContaining({ path, code: 'custom' })]);
    expect(error.message).toContain(`Field '${field}' on object '${object}' in package '${packageId}'`);
    expect(error.message).toContain("the `__c` suffix is reserved to a base's paired `.custom` package (ADR-0146 D10); rename the field.");
}

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

afterEach(() => vi.restoreAllMocks());

const commitRow = (items: unknown[]) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

// ═══════════════════════════════════════════════════════════════════════════
// 0. The judge
// ═══════════════════════════════════════════════════════════════════════════

describe('[ADR-0146 D10] judgeExtensionFieldSuffix — the two cases', () => {
    const vendor = 'com.acme.crm';
    const pair = 'com.acme.crm.custom';

    it('(a) a plain package: a `__c` field on its own object and in its extension is refused, each located', () => {
        const refusals = judgeExtensionFieldSuffix({
            packageId: vendor,
            objects: [obj('crm_account', 'Account', 'region__c')],
            objectExtensions: [{ extend: 'base_contact', fields: { tier__c: { type: 'text' }, tier: { type: 'text' } } }],
            at: 'packages[0].manifest.',
        });
        expect(refusals.map((r) => [r.rule, r.path, r.object, r.field])).toEqual([
            ['reserved_outside_pair', 'packages[0].manifest.objects[0].fields.region__c', 'crm_account', 'region__c'],
            ['reserved_outside_pair', 'packages[0].manifest.objectExtensions[0].fields.tier__c', 'base_contact', 'tier__c'],
        ]);
        expect(refusals[0]!.message).toBe(
            "Field 'region__c' on object 'crm_account' in package 'com.acme.crm': the `__c` suffix is reserved to a base's "
            + 'paired `.custom` package (ADR-0146 D10); rename the field.',
        );
    });

    it('(b) a `.custom` pair: an extension field without the suffix is refused with the patch-slot prescription', () => {
        const refusals = judgeExtensionFieldSuffix({
            packageId: pair,
            objectExtensions: [{ extend: 'crm_account', fields: { region: { type: 'text' }, region__c: { type: 'text' } } }],
        });
        expect(refusals.map((r) => [r.rule, r.path, r.field])).toEqual([
            ['unsuffixed_in_pair', 'objectExtensions[0].fields.region', 'region'],
        ]);
        expect(refusals[0]!.message).toBe(
            "Extension field 'region' on object 'crm_account' in package 'com.acme.crm.custom': name it `region__c`, or "
            + "change a base field's display properties in the extension's patch (`fieldPatches`).",
        );
    });

    it('a `.custom` extension field `region__c` is admitted, and a vendor extension\'s plain field is admitted', () => {
        expect(judgeExtensionFieldSuffix({
            packageId: pair, objectExtensions: [{ extend: 'crm_account', fields: { region__c: { type: 'text' } } }],
        })).toEqual([]);
        expect(judgeExtensionFieldSuffix({
            packageId: vendor, objectExtensions: [{ extend: 'base_contact', fields: { tier: { type: 'text' } } }],
        })).toEqual([]);
    });

    it('a `.custom` pair\'s own new objects are not judged, nor an extension of one of them', () => {
        expect(judgeExtensionFieldSuffix({
            packageId: pair,
            objects: [obj('crm_custom_survey', 'Survey', 'score', 'note__c')],
            objectExtensions: [{ extend: 'crm_custom_survey', fields: { extra: { type: 'text' } } }],
        })).toEqual([]);
    });

    it('a subject bound to no package is not judged; the pair rule is the spec\'s (`a.custom.custom` is no pair)', () => {
        for (const packageId of [undefined, null, '']) {
            expect(judgeExtensionFieldSuffix({ packageId, objects: [obj('t', 'T', 'x__c')] })).toEqual([]);
        }
        expect(judgeExtensionFieldSuffix({ packageId: 'com.acme.crm.custom.custom', objects: [obj('t', 'T', 'x__c')] }))
            .toEqual([expect.objectContaining({ rule: 'reserved_outside_pair' })]);
    });

    it('reads an `objects` record keyed by name and a `fields` array of `{ name }` entries; a bare `__c` is no extension name', () => {
        const refusals = judgeExtensionFieldSuffix({
            packageId: vendor,
            objects: { crm_lead: { fields: [{ name: 'title' }, { name: 'score__c' }, { name: '__c' }] } },
        });
        expect(refusals.map((r) => [r.path, r.object])).toEqual([['objects.crm_lead.fields[1]', 'crm_lead']]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The save door
// ═══════════════════════════════════════════════════════════════════════════

describe('[ADR-0146 D10] the save door refuses an object field spelled `__c` outside a `.custom` pair', () => {
    it.each(['publish', 'draft'] as const)('%s mode: an object saved into a plain package with `x__c` is refused; nothing stored', async (mode) => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'object', name: 'probe_ticket', item: obj('probe_ticket', 'Ticket', 'x__c'), packageId: BOUND, mode,
        }));
        expectReservedRefusal(error, 'x__c', 'probe_ticket', BOUND);
        expect(storedObjects(h)).toEqual([]);
    });

    it('every refused field is located in `issues`, and the message counts the rest', async () => {
        const h = makeProtocol();
        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'object', name: 'probe_ticket', item: obj('probe_ticket', 'Ticket', 'x__c', 'y__c'), packageId: BOUND,
        }));
        expectEnvelope(error);
        expect(error.issues.map((i: any) => i.path)).toEqual(['fields.x__c', 'fields.y__c']);
        expect(error.message).toContain('(1 more field in `issues`.)');
        expect(storedObjects(h)).toEqual([]);
    });

    it('CONTROL: the same `x__c` object saved into the `.custom` pair is admitted (its own object); a plain field into the plain package too; and a save into no package is not judged', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'object', name: 'probe_ticket', item: obj('probe_ticket', 'Ticket', 'x__c'), packageId: PAIR });
        await h.protocol.saveMetaItem({ type: 'object', name: 'probe_plain', item: obj('probe_plain', 'Plain', 'region'), packageId: BOUND });
        await h.protocol.saveMetaItem({ type: 'object', name: 'probe_env', item: obj('probe_env', 'Env', 'x__c') });
        expect(storedObjects(h)).toEqual([
            { row: 'probe_ticket', state: 'active', binding: PAIR, fields: ['title', 'x__c'] },
            { row: 'probe_plain', state: 'active', binding: BOUND, fields: ['title', 'region'] },
            { row: 'probe_env', state: 'active', binding: null, fields: ['title', 'x__c'] },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The restore doors
// ═══════════════════════════════════════════════════════════════════════════

/** probe_ticket at v1, v2, v3 through the real door into `binding`; v2's stored history body then carries `x__c`. */
async function threeVersionsWithFieldResidueAtV2(h: Harness, binding: string) {
    for (const label of ['v1', 'v2', 'v3']) {
        await h.protocol.saveMetaItem({ type: 'object', name: 'probe_ticket', item: obj('probe_ticket', label), packageId: binding });
    }
    residueField(h, { name: 'probe_ticket', version: 2 }, 'x__c');
    h.saveDoor.mockClear();
    return { historyBefore: h.historyRows.length, activeBefore: JSON.stringify(storedObjects(h)) };
}

describe('[ADR-0146 D10] the restore doors refuse a stored version carrying a `__c` field outside a `.custom` pair', () => {
    it('rollbackMetaItem: the version is refused; the active row and the history are unchanged', async () => {
        const h = makeProtocol();
        const before = await threeVersionsWithFieldResidueAtV2(h, BOUND);

        const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: 'object', name: 'probe_ticket', toVersion: 2 }));

        expectReservedRefusal(error, 'x__c', 'probe_ticket', BOUND);
        expect(JSON.stringify(storedObjects(h))).toBe(before.activeBefore);
        expect(h.historyRows.length).toBe(before.historyBefore);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('revertCommit\'s restore limb reports it in failed[] with the envelope\'s code; nothing is written', async () => {
        const h = makeProtocol();
        const before = await threeVersionsWithFieldResidueAtV2(h, BOUND);
        h.serveCommit(commitRow([{ type: 'object', name: 'probe_ticket', existedBefore: true, prevVersion: 2 }]));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'probe_ticket', code: 'VALIDATION_ERROR' })]);
        expect(res.failed[0].error).toContain('the `__c` suffix is reserved');
        expect(JSON.stringify(storedObjects(h))).toBe(before.activeBefore);
    });

    it('CONTROL: the same `x__c` version restored into the `.custom` pair\'s row is admitted, and a clean version into the plain one', async () => {
        const pairH = makeProtocol();
        await threeVersionsWithFieldResidueAtV2(pairH, PAIR);
        expect((await pairH.protocol.rollbackMetaItem({ type: 'object', name: 'probe_ticket', toVersion: 2 })).success).toBe(true);
        expect(storedObjects(pairH)).toEqual([{ row: 'probe_ticket', state: 'active', binding: PAIR, fields: ['title', 'x__c'] }]);

        const plainH = makeProtocol();
        await threeVersionsWithFieldResidueAtV2(plainH, BOUND);
        expect((await plainH.protocol.rollbackMetaItem({ type: 'object', name: 'probe_ticket', toVersion: 1 })).success).toBe(true);
        expect(storedObjects(plainH)).toEqual([{ row: 'probe_ticket', state: 'active', binding: BOUND, fields: ['title'] }]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The draft promotion (publishMetaItem, and the batch that shares it)
// ═══════════════════════════════════════════════════════════════════════════

/** A clean draft of probe_ticket saved into `binding` (and probe_ok beside it), the draft's body then carrying `x__c`. */
async function draftWithFieldResidue(h: Harness, binding: string) {
    await h.protocol.saveMetaItem({ type: 'object', name: 'probe_ok', item: obj('probe_ok', 'Ok'), packageId: binding, mode: 'draft' });
    await h.protocol.saveMetaItem({ type: 'object', name: 'probe_ticket', item: obj('probe_ticket', 'Ticket'), packageId: binding, mode: 'draft' });
    residueField(h, { name: 'probe_ticket', state: 'draft' }, 'x__c');
    h.saveDoor.mockClear();
}

describe('[ADR-0146 D10] the draft promotion refuses an object draft carrying a `__c` field outside a `.custom` pair', () => {
    it('publishMetaItem: the draft is refused and kept; nothing goes live', async () => {
        const h = makeProtocol();
        await draftWithFieldResidue(h, BOUND);

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'object', name: 'probe_ticket' }));

        expectReservedRefusal(error, 'x__c', 'probe_ticket', BOUND);
        expect(storedObjects(h).filter((r) => r.row === 'probe_ticket')).toEqual([
            { row: 'probe_ticket', state: 'draft', binding: BOUND, fields: ['title', 'x__c'] },
        ]);
        expect(h.saveDoor).not.toHaveBeenCalled();
    });

    it('publishPackageDrafts: the refused draft aborts the batch, reported with the envelope\'s code; nothing goes live', async () => {
        const h = makeProtocol();
        await draftWithFieldResidue(h, BOUND);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.publishPackageDrafts({ packageId: BOUND });

        expect(res.outcome).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed.find((f: any) => f.name === 'probe_ticket')).toMatchObject({ type: 'object', code: 'VALIDATION_ERROR' });
        expect(storedObjects(h).every((r) => r.state === 'draft')).toBe(true);
    });

    it('CONTROL: the same batch in the `.custom` pair publishes both, the `x__c` field included', async () => {
        const h = makeProtocol();
        await draftWithFieldResidue(h, PAIR);

        const res = await h.protocol.publishPackageDrafts({ packageId: PAIR });

        expect(res.outcome).toBe('published');
        expect(res.publishedCount).toBe(2);
        expect(storedObjects(h).filter((r) => r.state === 'active').map((r) => [r.row, r.fields])).toEqual([
            ['probe_ok', ['title']],
            ['probe_ticket', ['title', 'x__c']],
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. duplicatePackage, judged against the target id
// ═══════════════════════════════════════════════════════════════════════════

describe('[ADR-0146 D10] duplicatePackage from a `.custom` pair into a plain id is refused whole', () => {
    const SRC = 'app.dupsrc.custom';
    const DST = 'app.dupdst';

    it('an object carrying `__c` would land in the plain target: refused before anything is minted or copied', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'object', name: 'dupsrc_survey', item: obj('dupsrc_survey', 'Survey', 'score__c'), packageId: SRC });
        await h.protocol.saveMetaItem({ type: 'object', name: 'dupsrc_note', item: obj('dupsrc_note', 'Note'), packageId: SRC });
        h.saveDoor.mockClear();

        const { error } = await attempt(() => h.protocol.duplicatePackage({ sourcePackageId: SRC, targetPackageId: DST }));

        expectEnvelope(error);
        expect(error.issues).toEqual([expect.objectContaining({ path: 'objects.dupsrc_survey.fields.score__c', code: 'custom' })]);
        expect(error.message).toContain(`in package '${DST}': the \`__c\` suffix is reserved`);
        expect(h.saveDoor).not.toHaveBeenCalled();
        expect(storedObjects(h).filter((r) => r.binding === DST)).toEqual([]);
    });

    it('CONTROL: the same source without the `__c` field copies', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'object', name: 'dupsrc_note', item: obj('dupsrc_note', 'Note'), packageId: SRC });

        const res = await h.protocol.duplicatePackage({ sourcePackageId: SRC, targetPackageId: DST });

        expect(res.failed).toEqual([]);
        expect(res.copiedCount).toBe(1);
        expect(storedObjects(h).filter((r) => r.binding === DST)).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. installPackage — covered by its closed manifest
// ═══════════════════════════════════════════════════════════════════════════

describe('[ADR-0146 D10] installPackage cannot carry a field body: its closed manifest refuses one before any write', () => {
    it.each([
        ['an object body with `x__c`', { objects: [obj('probe_ticket', 'Ticket', 'x__c')] }],
        ['an `objectExtensions` entry with `x__c`', { objectExtensions: [{ extend: 'base_contact', fields: { x__c: { type: 'text' } } }] }],
    ])('%s is refused 400 by `PackageInstallManifestSchema`; the registry is never written', async (_label, extra) => {
        const h = makeProtocol();
        const installPackage = vi.fn();
        h.engine.registry.installPackage = installPackage;

        const { error } = await attempt(() => h.protocol.installPackage({
            manifest: { id: 'com.acme.vendor', name: 'Vendor', type: 'app', version: '1.0.0', ...extra },
        }));

        expect(error).toBeInstanceOf(Error);
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Invalid package manifest');
        expect(installPackage).not.toHaveBeenCalled();
    });
});
