// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2 and D6, amended; #33593 ruling R1] The per-item publish of an
 * `object_extension` draft (`POST /meta/object_extension/:name/publish`,
 * `publishMetaItem`) asks the registry's record-currency follow door, as the
 * published save of the same body does (`saveMetaItem`, the R1 block).
 *
 * Measured at the protocol method that route calls, over a real kernel, a real
 * `SchemaRegistry` and the real protocol (only the driver an in-memory double),
 * before the fix: a draft adding a record-mode amount whose `currencyField`
 * the served object cannot satisfy saved `200`, its per-item publish answered
 * `success: true` ("Published draft"), the draft was promoted and the amount
 * registered. Then the first write of the amount was refused
 * (`ERR_CURRENCY_CODE_REQUIRED`) for a pointer naming no field (`zz_missing`,
 * one segment) or a `master_detail`-led pointer to a parent field that does
 * not exist — and for a `master_detail`-led pointer to a parent field holding
 * no code (`invoice.title`) the write was stored with a "currency" nobody
 * declared. The published save of each body answered `422 INVALID_METADATA`
 * with the registry's sentence; `publishPackageDrafts` refused each too.
 *
 * Pinned here, on the per-item publish of a stored draft:
 *  - both shapes are refused `422 INVALID_METADATA` with the save door's own
 *    refusal of the same body (the same message), and the draft stays a
 *    draft: no active row, the draft row as it was;
 *  - the question is the save door's: the extension as its object will be
 *    served (`name` its target, no `extend` / `priority`), the package
 *    promoted into, ownership `'extend'`, `againstRegistry: true`;
 *  - CONTROL: a pointer the served object satisfies, one segment or
 *    `master_detail`-led, publishes and is promoted.
 *
 * The registry here is a double: it records each question and judges a
 * record-mode pointer against the objects it serves (below), so this file pins
 * the DOOR — that it asks, what it asks, and that it relays the answer before
 * anything is promoted. The registry's own judgement is pinned over the real
 * `SchemaRegistry` in `packages/objectql/src/protocol-batch-object-registration.test.ts`
 * (the published save of the same two shapes). This package cannot import
 * `@objectstack/objectql` (that import would close a cycle).
 *
 * Harness: the stateful `sys_metadata` double of
 * `protocol.unknown-picklist-binding-refusal.test.ts`, kept local.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface FollowCall {
    schema: any;
    packageId: string | undefined;
    ownership: string;
    options: { againstRegistry?: boolean };
}

const CODE = { valueDomain: 'iso_4217_currency' } as const;

/** The objects the registry double serves: an invoice holding a code, and a line under it. */
const SERVED: Record<string, { name: string; fields: Record<string, any> }> = {
    qa_invoice: {
        name: 'qa_invoice',
        fields: {
            title: { type: 'text', label: 'Title' },
            currency_code: { type: 'text', label: 'Currency', ...CODE },
        },
    },
    qa_line: {
        name: 'qa_line',
        fields: {
            title: { type: 'text', label: 'Title' },
            invoice: { type: 'master_detail', label: 'Invoice', reference: 'qa_invoice' },
        },
    },
};

const holdsCode = (f: any) => f?.type === 'text' && f?.valueDomain === CODE.valueDomain;

/**
 * The double's follow judgement of an `extend` layer, as its object will be
 * served (the served fields and the layer's): a record-mode amount's pointer
 * names a sibling field holding a code, or `master_detail.code_field` on the
 * parent that master_detail references. Its refusal carries the real one's
 * envelope (`RecordCurrencyFollowRefusedError`, `422 INVALID_METADATA`).
 */
function followRefusal(schema: { name: string; fields?: Record<string, any> }): Error | null {
    const served = { ...(SERVED[schema.name]?.fields ?? {}), ...(schema.fields ?? {}) };
    for (const [fieldName, field] of Object.entries(schema.fields ?? {})) {
        const cfg = field?.currencyConfig;
        if (cfg?.currencyMode !== 'record' || typeof cfg.currencyField !== 'string') continue;
        const [head, tail] = cfg.currencyField.split('.');
        const ok = tail === undefined
            ? holdsCode(served[head])
            : served[head]?.type === 'master_detail' && holdsCode(SERVED[served[head].reference]?.fields?.[tail]);
        if (ok) continue;
        const err = new Error(
            `Object '${schema.name}' field '${fieldName}' currencyConfig.currencyField: '${cfg.currencyField}' names no code field the served object can follow.`,
        ) as Error & { code: string; status: number; objectName: string; fieldName: string };
        err.name = 'RecordCurrencyFollowRefusedError';
        err.code = 'INVALID_METADATA';
        err.status = 422;
        err.objectName = schema.name;
        err.fieldName = fieldName;
        return err;
    }
    return null;
}

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const PKG = 'app.followprobe';

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

function makeSession() {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    const asked: FollowCall[] = [];
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
        // The objects an `object_extension` may extend, as they are served.
        getObject: (name: string) => SERVED[name],
        // An installed authored base that declares no namespace.
        getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
        getArtifactItem: () => undefined,
        isPackageDisabled: () => false,
    };
    // The follow door, as the save door and the per-item publish ask it: it
    // records each question and answers the double's judgement below.
    registry.objectRegistrationRefusal = (schema: any, packageId: string | undefined, ownership: string, options: { againstRegistry?: boolean }) => {
        asked.push({ schema, packageId, ownership, options });
        return ownership === 'extend' && options?.againstRegistry === true ? followRefusal(schema) : null;
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
        async syncObjectSchema() { return true; },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, asked };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

/** The stored rows of one extension, as `state|package|fee pointer`. */
const stored = (rows: Map<string, Row>, name: string) =>
    [...rows.values()]
        .filter((r) => r.type === 'object_extension' && r.name === name)
        .map((r) => `${r.state}|${r.package_id ?? '-'}|${JSON.parse(r.metadata).fields?.fee?.currencyConfig?.currencyField ?? ''}`)
        .sort();

/** An extension adding one record-mode amount, `fee`, that follows `pointer`. */
const extension = (target: string, pointer: string) => ({
    extend: target,
    fields: { fee: { type: 'currency', label: 'Fee', currencyConfig: { currencyMode: 'record', currencyField: pointer } } },
});

/** What the published save of the same body answers: the save door's refusal. */
async function saveDoorRefusal(target: string, pointer: string): Promise<any> {
    const { protocol } = makeSession();
    return refusalOf(protocol.saveMetaItem({
        type: 'object_extension', name: target, packageId: PKG, mode: 'publish', writeFace: 'meta-envelope',
        item: extension(target, pointer),
    }));
}

const SHAPES = [
    ['a one-segment pointer naming no field of the served object', 'qa_invoice', 'zz_missing'],
    ['a master_detail-led pointer to a parent field holding no code', 'qa_line', 'invoice.title'],
] as const;

describe('the per-item publish of an object_extension draft asks the follow door its published save asks', () => {
    it.each(SHAPES)('%s: refused 422 INVALID_METADATA with the save door\'s refusal, and the draft stays a draft', async (_label, target, pointer) => {
        const fromSave = await saveDoorRefusal(target, pointer);
        expect({ code: fromSave?.code, status: fromSave?.status }, String(fromSave?.stack ?? fromSave)).toEqual({ code: 'INVALID_METADATA', status: 422 });

        const { protocol, rows, asked } = makeSession();
        // A draft is judged when it is published: the draft save answers 200.
        const draft = await protocol.saveMetaItem({ type: 'object_extension', name: target, packageId: PKG, mode: 'draft', item: extension(target, pointer) });
        expect(draft.success).toBe(true);
        expect(stored(rows, target)).toEqual([`draft|${PKG}|${pointer}`]);
        expect(asked).toEqual([]);

        const err = await refusalOf(protocol.publishMetaItem({ type: 'object_extension', name: target, packageId: PKG }));

        expect({ code: err?.code, status: err?.status }, String(err?.stack ?? err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.name).toBe('RecordCurrencyFollowRefusedError');
        expect(err.message).toBe(fromSave.message);
        expect(err.message.startsWith(`Object '${target}' field 'fee' currencyConfig.currencyField: '${pointer}'`), err.message).toBe(true);
        // Nothing promoted: no active row, the draft row as it was.
        expect(stored(rows, target)).toEqual([`draft|${PKG}|${pointer}`]);
        // The save door's question: the extension as its object will be served, in the slot of the package promoted into.
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ packageId: PKG, ownership: 'extend', options: { againstRegistry: true } });
        expect(asked[0].schema.name).toBe(target);
        expect(asked[0].schema).not.toHaveProperty('extend');
        expect(asked[0].schema).not.toHaveProperty('priority');
        expect(asked[0].schema.fields.fee.currencyConfig).toEqual({ currencyMode: 'record', currencyField: pointer });
    });

    it.each([
        ['a one-segment pointer naming the served code field', 'qa_invoice', 'currency_code'],
        ['a master_detail-led pointer to the parent\'s code field', 'qa_line', 'invoice.currency_code'],
    ] as const)('CONTROL: %s publishes, and the draft is promoted', async (_label, target, pointer) => {
        const { protocol, rows, asked } = makeSession();
        await protocol.saveMetaItem({ type: 'object_extension', name: target, packageId: PKG, mode: 'draft', item: extension(target, pointer) });

        const res = await protocol.publishMetaItem({ type: 'object_extension', name: target, packageId: PKG });

        expect(res.success, JSON.stringify(res)).toBe(true);
        expect(stored(rows, target)).toEqual([`active|${PKG}|${pointer}`]);
        expect(asked.filter((c) => c.ownership === 'extend' && c.options?.againstRegistry === true)).toHaveLength(1);
    });
});
