// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23603 rows 4-5 — the reference-cleanup write a `set_null` delete issues: an
 * UPDATE of the holder, through the holder's own hooks, under the CALLER's
 * context plus the referential-clear marker.
 *
 * Replaces the platform half of two objectstack-ai/hotcrm files (the R residues
 * in #15953's classification table, rows 4 and 5), so hotcrm can retire those
 * describes (objectstack-ai/hotcrm#1583):
 *
 *   - `test/lead-duplicate-link-cleanup.test.ts` — "the engine runs a
 *     `set_null` clear as an UPDATE that reaches `beforeUpdate` with the
 *     caller's identity, indistinguishable from a hand-clear";
 *   - `test/freeze-guard-reference-cleanup.test.ts` — the cleanup write's
 *     context table: the caller context spread, plus the marker.
 *
 * Their K halves stay in hotcrm: which hotcrm hook yields to the cleanup, and
 * how, is the app's ruling.
 *
 * ## What is pinned
 *
 * `cascadeDeleteRelations` builds the cleanup context as
 * `{ ...callerContext, __referentialFieldClear: true, … }` and writes
 * `{ id, LINK: null }` through the public `update()`. So, on the holder's
 * `beforeUpdate`:
 *
 *   - the payload is `{ id, LINK: null }` (plus the audit stamps), nothing more;
 *   - the identity is whatever the DELETE carried — hotcrm measured three
 *     callers (a REST-shaped `{ userId, isSystem }`, a bare `{ isSystem }`,
 *     and no context at all) and found the two disagreeing readings in its
 *     own history were rig artefacts of exactly this inheritance;
 *   - against a hand-clear of the SAME lookup under the SAME identity, the
 *     payload and the session are identical, and the DECLARED
 *     `ctx.referentialFieldClear` is the one member that differs;
 *   - the referenced record is still readable at that moment, so existence is
 *     no discriminator either;
 *   - a holder hook that refuses the cleanup refuses the whole delete (the
 *     #720 shape hotcrm's freeze guards produced).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$or') { if (!(v as any[]).some((sub) => matches(row, sub))) return false; continue; }
            if (k === '$and') { if (!(v as any[]).every((sub) => matches(row, sub))) return false; continue; }
            if (k.startsWith('$')) continue;
            const want = v !== null && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (want ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
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

const contact = {
    name: 'contact', label: 'Contact',
    fields: { name: { name: 'name', type: 'text' as const } },
};
/** The holder: an optional lookup on the spec default, `set_null`. */
const lead = {
    name: 'lead', label: 'Lead',
    fields: {
        name: { name: 'name', type: 'text' as const },
        duplicate_of: { name: 'duplicate_of', type: 'lookup' as const, reference: 'contact', deleteBehavior: 'set_null' as const },
    },
};

type Seen = {
    data: Record<string, unknown>;
    sessionUserId: unknown;
    sessionIsSystem: unknown;
    marker: unknown;
    referencedStillReadable: number;
};

/** The three caller contexts hotcrm's table varies, by name. */
const CALLERS: Array<[label: string, ctx: Record<string, unknown> | undefined]> = [
    ['{ userId, isSystem } (a REST DELETE)', { userId: 'u1', isSystem: true }],
    ['{ isSystem }', { isSystem: true }],
    ['no context at all', undefined],
];

describe('rows 4-5 — the set_null cleanup is an UPDATE under the caller\'s context (hotcrm lead-duplicate-link-cleanup, freeze-guard-reference-cleanup)', () => {
    let engine: ObjectQL;
    let storeFor: ReturnType<typeof makeStubDriver>['storeFor'];
    let seen: Seen[];
    let refuse: boolean;

    beforeEach(async () => {
        engine = new ObjectQL();
        const d = makeStubDriver();
        storeFor = d.storeFor;
        engine.registerDriver(d.driver, true);
        await engine.init();
        for (const o of [contact, lead]) engine.registry.registerObject(o as any);
        seen = [];
        refuse = false;
        engine.on('beforeUpdate', 'lead', async (ctx: any) => {
            const ref = storeFor('lead').get(ctx.input?.id)?.duplicate_of;
            seen.push({
                data: { ...(ctx.input?.data ?? {}) },
                sessionUserId: ctx.session?.userId,
                sessionIsSystem: ctx.session?.isSystem,
                marker: ctx.referentialFieldClear,
                referencedStillReadable: ref ? await engine.count('contact', { where: { id: ref } } as any) : 0,
            });
            if (refuse) throw new Error('settled record: the link may not change');
        });
    });

    const seed = async () => {
        const c = await engine.insert('contact', { name: 'Survivor' });
        const l = await engine.insert('lead', { name: 'Dupe', duplicate_of: c.id });
        return { c, l };
    };
    const payloadKeys = (s: Seen) => Object.keys(s.data).filter((k) => !['updated_at', 'updated_by'].includes(k)).sort();

    it.each(CALLERS)('the cleanup inherits the DELETE\'s context — %s', async (_label, ctx) => {
        const { c, l } = await seed();

        await engine.delete('contact', { where: { id: c.id }, ...(ctx ? { context: ctx } : {}) } as any);

        expect(seen).toHaveLength(1);
        const [w] = seen;
        expect(w.data.duplicate_of, 'this is the cleanup write').toBeNull();
        expect(payloadKeys(w), 'it writes the row address and the link, nothing else').toEqual(['duplicate_of', 'id']);
        expect(w.marker, 'and it is marked on the declared hook face').toBe(true);
        expect(w.sessionUserId).toBe(ctx?.userId);
        expect(w.sessionIsSystem ?? undefined).toBe(ctx?.isSystem);
        expect(w.referencedStillReadable, 'the referenced record still exists while its holders are cleared').toBe(1);
        expect(storeFor('lead').get(l.id)?.duplicate_of).toBeNull();
        expect(storeFor('contact').has(c.id)).toBe(false);
    });

    it('against a hand-clear under the same identity, only ctx.referentialFieldClear differs', async () => {
        const CALLER = { userId: 'u1', isSystem: true };
        const { c, l } = await seed();

        await engine.update('lead', { id: l.id, duplicate_of: null }, { context: { ...CALLER } } as any);
        await engine.update('lead', { id: l.id, duplicate_of: c.id }, { context: { ...CALLER } } as any);
        await engine.delete('contact', { where: { id: c.id }, context: { ...CALLER } } as any);

        expect(seen).toHaveLength(3);
        const [hand, , cascade] = seen;
        expect(payloadKeys(cascade)).toEqual(payloadKeys(hand));
        expect(cascade.data.duplicate_of).toBe(hand.data.duplicate_of);
        expect([cascade.sessionUserId, cascade.sessionIsSystem]).toEqual([hand.sessionUserId, hand.sessionIsSystem]);
        expect(cascade.referencedStillReadable).toBe(1);
        expect(hand.marker).toBeUndefined();
        expect(cascade.marker).toBe(true);
    });

    it('a holder hook that refuses the cleanup write refuses the whole delete', async () => {
        const { c, l } = await seed();
        refuse = true;

        await expect(engine.delete('contact', { where: { id: c.id }, context: { userId: 'u1', isSystem: true } } as any))
            .rejects.toThrow('settled record');

        expect(seen).toHaveLength(1);
        expect(storeFor('contact').has(c.id), 'the referenced record survives').toBe(true);
        expect(storeFor('lead').get(l.id)?.duplicate_of).toBe(c.id);
    });
});
