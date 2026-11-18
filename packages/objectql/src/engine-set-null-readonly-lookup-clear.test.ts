// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `set_null` delete walk's clear of a READ-ONLY lookup.
 *
 * Deleting a record makes the engine clear every optional lookup pointing at
 * it (`deleteBehavior: 'set_null'`, the default): an UPDATE of the holder,
 * `{ id, LINK: null }` (or, on a `multiple: true` lookup, the member list
 * without the deleted id), under the CALLER's context. When LINK was declared
 * `readonly: true` — the normal shape for a stamp a system writes — the
 * update-side read-only strip treated that clear as a forged caller write,
 * dropped it and logged "DROPPED ... COMMITTED WITHOUT IT": the delete
 * answered 200 and every holder kept the deleted row's id.
 *
 * ## What is pinned
 *
 *  - the clear lands on a `readonly` lookup and on a `readonlyWhen`-locked
 *    one, single- and multi-valued, under a user context and under none, and
 *    no read-only drop line is logged for it;
 *  - the holder's `beforeUpdate` is handed the clear it is about to store;
 *  - a non-read-only lookup is cleared exactly as before (the control);
 *  - the exemption is the walk's alone: a caller update that carries the
 *    referential-clear marker on its context through the normal door is still
 *    stripped and still logged, and still refused under
 *    `strictReadonlyWrites`;
 *  - and it is one key wide: a second read-only key in the same write, or the
 *    cleared key holding any other value, is still stripped and still logged
 *    (unit level, where one payload can carry both).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { stripReadonlyFields, stripReadonlyWhenFields } from './validation/rule-validator.js';

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const holds = (value: unknown, cond: unknown): boolean => {
        if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
            const c = cond as Record<string, unknown>;
            if ('$eq' in c) return (value ?? null) === (c.$eq ?? null);
            if ('$in' in c) return (c.$in as unknown[]).some((v) => String(v) === String(value));
            if ('$contains' in c) {
                if (Array.isArray(value)) return value.some((m) => String(m).includes(String(c.$contains)));
                return typeof value === 'string' && value.includes(String(c.$contains));
            }
            if ('$ne' in c) return (value ?? null) !== (c.$ne ?? null);
            return false;
        }
        return (value ?? null) === (cond ?? null);
    };
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$or') { if (!(v as any[]).some((sub) => matches(row, sub))) return false; continue; }
            if (k === '$and') { if (!(v as any[]).every((sub) => matches(row, sub))) return false; continue; }
            if (k.startsWith('$')) continue;
            if (!holds(row[k], v)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) {
            const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, storeFor };
}

const milestone = {
    name: 'ro_milestone', label: 'Milestone',
    fields: { name: { name: 'name', type: 'text' as const } },
};
/** The holder: every lookup on the spec default `deleteBehavior` (`set_null`). */
const entry = {
    name: 'ro_entry', label: 'Entry',
    fields: {
        name: { name: 'name', type: 'text' as const },
        /** The reported shape: a stamp a system writes, read-only to callers. */
        billed_on: { name: 'billed_on', type: 'lookup' as const, reference: 'ro_milestone', readonly: true },
        /** A read-only SET of references. */
        billed_on_many: { name: 'billed_on_many', type: 'lookup' as const, reference: 'ro_milestone', multiple: true, readonly: true },
        /** A conditional lock that is always closed. */
        locked_link: { name: 'locked_link', type: 'lookup' as const, reference: 'ro_milestone', readonlyWhen: 'true' },
        /** The control: an ordinary, writable lookup. */
        plain_link: { name: 'plain_link', type: 'lookup' as const, reference: 'ro_milestone' },
        /** A second read-only column, for the one-key-wide pins. */
        stamp: { name: 'stamp', type: 'text' as const, readonly: true },
    },
};

/** Every line the read-only strips write: the static one and the `readonlyWhen` one. */
const isDropLine = (line: string) => /DROPPED|read-only \(readonlyWhen\)/.test(line);

const CALLERS: Array<[label: string, ctx: Record<string, unknown> | undefined]> = [
    ['a user context (an admin\'s REST DELETE)', { userId: 'u1' }],
    ['no context at all', undefined],
];

describe('the set_null walk clears a read-only lookup', () => {
    let engine: ObjectQL;
    let storeFor: ReturnType<typeof makeStubDriver>['storeFor'];
    let warns: string[];
    let hookSaw: Array<{ data: Record<string, unknown>; marker: unknown }>;

    beforeEach(async () => {
        warns = [];
        const quiet = () => {};
        engine = new ObjectQL({
            logger: { debug: quiet, info: quiet, error: quiet, warn: (m: unknown) => { warns.push(String(m)); } },
        } as any);
        const d = makeStubDriver();
        storeFor = d.storeFor;
        engine.registerDriver(d.driver, true);
        await engine.init();
        for (const o of [milestone, entry]) engine.registry.registerObject(o as any);
        hookSaw = [];
        engine.on('beforeUpdate', 'ro_entry', async (ctx: any) => {
            hookSaw.push({ data: { ...(ctx.input?.data ?? {}) }, marker: ctx.referentialFieldClear });
        });
    });

    /** Seed through the system door: a caller cannot write the read-only stamps. */
    const seed = async (values: Record<string, unknown>) =>
        engine.insert('ro_entry', { name: 'e', ...values }, { context: { isSystem: true } } as any);
    const del = (id: unknown, ctx: Record<string, unknown> | undefined) =>
        engine.delete('ro_milestone', { where: { id }, ...(ctx ? { context: ctx } : {}) } as any);

    it.each(CALLERS)('a readonly lookup reads null after its target is deleted, with no drop line — %s', async (_l, ctx) => {
        const m = await engine.insert('ro_milestone', { name: 'step 1' });
        const e = await seed({ billed_on: m.id });

        await del(m.id, ctx);

        expect(storeFor('ro_milestone').has(m.id)).toBe(false);
        expect(storeFor('ro_entry').get(e.id)?.billed_on, 'the deleted record\'s id is gone').toBeNull();
        expect(warns.filter(isDropLine), 'the engine\'s own clear is not a forged caller write').toEqual([]);
        const cleanup = hookSaw.find((s) => s.marker === true);
        expect(cleanup?.data.billed_on, 'the hook is handed the clear the write stores').toBeNull();
    });

    it.each(CALLERS)('a readonly multi-value lookup keeps its remaining ids, with no drop line — %s', async (_l, ctx) => {
        const a = await engine.insert('ro_milestone', { name: 'a' });
        const b = await engine.insert('ro_milestone', { name: 'b' });
        const e = await seed({ billed_on_many: [a.id, b.id] });

        await del(a.id, ctx);

        expect(storeFor('ro_entry').get(e.id)?.billed_on_many).toEqual([b.id]);
        expect(warns.filter(isDropLine)).toEqual([]);
    });

    it.each(CALLERS)('a readonlyWhen-locked lookup is cleared too, with no drop line — %s', async (_l, ctx) => {
        const m = await engine.insert('ro_milestone', { name: 'step 1' });
        const e = await seed({ locked_link: m.id });

        await del(m.id, ctx);

        expect(storeFor('ro_entry').get(e.id)?.locked_link).toBeNull();
        expect(warns.filter(isDropLine)).toEqual([]);
    });

    it('control: a writable lookup is cleared exactly as before', async () => {
        const m = await engine.insert('ro_milestone', { name: 'step 1' });
        const e = await seed({ plain_link: m.id });

        await del(m.id, { userId: 'u1' });

        expect(storeFor('ro_entry').get(e.id)?.plain_link).toBeNull();
        expect(warns.filter(isDropLine)).toEqual([]);
    });

    describe('the exemption is the walk\'s alone — a caller carrying the marker through the normal door', () => {
        const forged = (field: string, id: unknown, target: unknown) => ({
            userId: 'u1',
            __referentialFieldClear: true,
            __referentialFieldClearCause: { object: 'ro_milestone', id: target, referencingObject: 'ro_entry', referencingId: id, field },
        });

        it('is still stripped and still logged', async () => {
            const m = await engine.insert('ro_milestone', { name: 'step 1' });
            const e = await seed({ billed_on: m.id });

            await engine.update('ro_entry', { id: e.id, billed_on: null }, { context: forged('billed_on', e.id, m.id) } as any);

            expect(storeFor('ro_entry').get(e.id)?.billed_on, 'the marker grants a caller nothing').toBe(m.id);
            expect(warns.filter((w) => w.includes("'billed_on'") && w.includes('DROPPED'))).toHaveLength(1);
        });

        it('is still locked by readonlyWhen', async () => {
            const m = await engine.insert('ro_milestone', { name: 'step 1' });
            const e = await seed({ locked_link: m.id });

            await engine.update('ro_entry', { id: e.id, locked_link: null }, { context: forged('locked_link', e.id, m.id) } as any);

            expect(storeFor('ro_entry').get(e.id)?.locked_link).toBe(m.id);
            expect(warns.filter((w) => w.includes("'locked_link'") && w.includes('readonlyWhen'))).toHaveLength(1);
        });

        it('is still refused under strictReadonlyWrites', async () => {
            const m = await engine.insert('ro_milestone', { name: 'step 1' });
            const e = await seed({ billed_on: m.id });

            const refusal = await engine
                .update('ro_entry', { id: e.id, billed_on: null }, { context: forged('billed_on', e.id, m.id), strictReadonlyWrites: true } as any)
                .then(() => undefined, (err: unknown) => err as { code?: unknown; fields?: unknown });

            expect(refusal?.code).toBe('ERR_READONLY_FIELD_REJECTED');
            expect(refusal?.fields).toEqual(['billed_on']);
            expect(storeFor('ro_entry').get(e.id)?.billed_on).toBe(m.id);
        });
    });
});

describe('the strips\' referential-clear exemption is one key, one value wide', () => {
    const schema = { name: 'ro_entry', fields: entry.fields as Record<string, any> };

    it('static strip: keeps the cleared key at the walk\'s value; strips and logs every other read-only key', () => {
        const warns: string[] = [];
        const logger = { warn: (m: string) => { warns.push(m); } } as any;
        const data = { billed_on: null, stamp: 'forged' };

        const out = stripReadonlyFields(schema, data, { ...data }, logger, { referentialClear: { field: 'billed_on', value: null } });

        expect(out).toEqual({ billed_on: null });
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain("'stamp'");
    });

    it('static strip: the cleared key holding any other value is stripped and logged', () => {
        const warns: string[] = [];
        const logger = { warn: (m: string) => { warns.push(m); } } as any;
        const data = { billed_on: 'other_row' };

        const out = stripReadonlyFields(schema, data, { ...data }, logger, { referentialClear: { field: 'billed_on', value: null } });

        expect(out).toEqual({});
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain("'billed_on'");
    });

    it('readonlyWhen strip: keeps the cleared key at the walk\'s value; locks it at any other value', () => {
        const warns: string[] = [];
        const logger = { warn: (m: string) => { warns.push(m); } } as any;

        const kept = stripReadonlyWhenFields(schema, { locked_link: null }, { locked_link: 'm1' }, logger, undefined, {
            referentialClear: { field: 'locked_link', value: null },
        });
        expect(kept).toEqual({ locked_link: null });
        expect(warns).toEqual([]);

        const locked = stripReadonlyWhenFields(schema, { locked_link: 'm2' }, { locked_link: 'm1' }, logger, undefined, {
            referentialClear: { field: 'locked_link', value: null },
        });
        expect(locked).toEqual({});
        expect(warns).toHaveLength(1);
    });
});
